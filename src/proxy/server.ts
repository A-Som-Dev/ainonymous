import * as http from 'node:http';
import * as crypto from 'node:crypto';
import type { AInonymousConfig, ApiFormat } from '../types.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { AuditLogger } from '../audit/logger.js';
import { serveDashboard, serveDashboardAsset, serveSSE } from '../audit/dashboard.js';
import { collectBody, parseRequest, replaceTextInJson, detectApiFormat } from './interceptor.js';
import { forwardWithRehydration } from './forwarder.js';
import { anonymizeHeaders } from './header-anonymizer.js';
import { scanAuditDir } from '../audit/verify-scan.js';
import { basename } from 'node:path';
import { log } from '../logger.js';

interface ProxyServerOptions {
  config: AInonymousConfig;
  upstream?: string;
  logger?: AuditLogger;
  pipeline?: Pipeline;
  shutdownToken?: string;
  mgmtToken?: string;
}

interface ProxyStats {
  requestCount: number;
  startedAt: number;
}

const PROTECTED_MGMT_PATHS = new Set([
  '/metrics',
  '/metrics/json',
  '/dashboard',
  '/dashboard/app.js',
  '/dashboard/app.css',
  '/events',
]);

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function extractBearerToken(req: http.IncomingMessage): string | null {
  const h = req.headers['authorization'];
  if (typeof h === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    if (m) return m[1].trim();
  }
  // Dashboard runs in a browser. a static HTML page can't set an
  // Authorization header on SSE (EventSource) or navigation requests, so we
  // also accept the token as a `?token=...` query param. Safe because the
  // server only listens on loopback by default and the token is 32 bytes
  // of random hex.
  const url = req.url ?? '';
  const q = url.indexOf('?');
  if (q >= 0) {
    const params = new URLSearchParams(url.slice(q + 1));
    const t = params.get('token');
    if (t) return t;
  }
  return null;
}

function requireMgmtAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  expected: string | undefined,
  path: string,
): boolean {
  if (!expected) return true;
  const provided = extractBearerToken(req);
  if (provided === null) {
    log.warn('management auth rejected', { path, reason: 'missing_token' });
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="ainonymous"',
    });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  if (!timingSafeStringEqual(provided, expected)) {
    log.warn('management auth rejected', { path, reason: 'invalid_token' });
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden' }));
    return false;
  }
  return true;
}

export function createProxyServer(opts: ProxyServerOptions): ProxyServer {
  const auditLogger = opts.logger ?? new AuditLogger();

  if (opts.config.behavior.auditLog) {
    const dir = opts.config.behavior.auditDir || './ainonymous-audit';
    auditLogger.enablePersistence(dir, opts.config.behavior.auditFailure);
  }

  log.info('audit_posture', {
    audit_log: opts.config.behavior.auditLog,
    audit_failure: opts.config.behavior.auditFailure,
    audit_dir: opts.config.behavior.auditDir || './ainonymous-audit',
    compliance: opts.config.behavior.compliance ?? 'none',
  });

  const pipeline = opts.pipeline ?? new Pipeline(opts.config, auditLogger);
  const stats: ProxyStats = { requestCount: 0, startedAt: Date.now() };
  const upstreamCfg = opts.config.behavior.upstream;
  const shutdownToken = opts.shutdownToken ?? crypto.randomBytes(16).toString('hex');

  const envMgmt = process.env['AINONYMOUS_MGMT_TOKEN']?.trim();
  if (envMgmt && envMgmt.length > 0 && envMgmt.length < 16) {
    throw new Error(
      'AINONYMOUS_MGMT_TOKEN must be at least 16 characters (got ' +
        envMgmt.length +
        '). Generate with: openssl rand -hex 24',
    );
  }
  const mgmtToken =
    envMgmt && envMgmt.length > 0 ? envMgmt : (opts.mgmtToken ?? opts.config.behavior.mgmtToken);

  function pickUpstream(format: ApiFormat): string {
    if (opts.upstream) return opts.upstream;
    if (format === 'openai') return upstreamCfg.openai;
    return upstreamCfg.anthropic;
  }

  async function handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    stats.requestCount++;

    try {
      const rawBody = await collectBody(req);
      const parsed = parseRequest(req, rawBody);
      const format = detectApiFormat(parsed.body, path);
      const upstream = pickUpstream(format);

      // Track every pseudonym actually emitted while anonymising this
      // request. The rehydrate pass is then restricted to exactly that set,
      // so a malicious upstream cannot echo unrelated pseudos back to probe
      // the session map (RT-Oracle attack).
      const usedPseudos = new Set<string>();
      const anonymizedBody = await replaceTextInJson(parsed.body, async (text) => {
        const result = await pipeline.anonymize(text);
        for (const r of result.replacements) usedPseudos.add(r.pseudonym);
        return result.text;
      });

      const outBody = JSON.stringify(anonymizedBody);
      const outHeaders = await anonymizeHeaders(parsed.headers, pipeline);

      const streamFormat = format === 'anthropic' || format === 'openai' ? format : undefined;
      forwardWithRehydration(
        {
          upstream,
          method: parsed.method,
          path: parsed.path,
          headers: outHeaders,
          body: outBody,
          streamFormat,
          maxPseudoLen: pipeline.getSessionMap().getMaxPseudonymLength(),
        },
        res,
        (chunk) => pipeline.rehydrate(chunk, { allowedPseudonyms: usedPseudos }),
      );
    } catch (err) {
      const isAuditFail = err instanceof Error && err.name === 'AuditPersistError';
      log.error('proxy request failed', {
        path,
        err: err instanceof Error ? err.message : String(err),
        auditFail: isAuditFail,
      });
      if (!res.headersSent) {
        res.writeHead(isAuditFail ? 503 : 500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: isAuditFail ? 'audit_persist_failed' : 'proxy_error' }));
    }
  }

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url ?? '/';
    const qIdx = rawUrl.indexOf('?');
    const path = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;

    if (PROTECTED_MGMT_PATHS.has(path)) {
      if (!requireMgmtAuth(req, res, mgmtToken, path)) return;
    }

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: Date.now() - stats.startedAt,
          requests: stats.requestCount,
          sessionMapSize: pipeline.getSessionMap().size,
        }),
      );
      return;
    }

    if (path === '/metrics') {
      const auditStats = auditLogger.stats();
      const auditDir = opts.config.behavior.auditDir || './ainonymous-audit';
      const scan = scanAuditDir(auditDir);
      const brokenFiles = scan.filter((r) => r.status !== 'ok');
      const lines = [
        '# HELP ainonymous_uptime_seconds Proxy uptime',
        '# TYPE ainonymous_uptime_seconds gauge',
        `ainonymous_uptime_seconds ${((Date.now() - stats.startedAt) / 1000).toFixed(3)}`,
        '# HELP ainonymous_requests_total API requests forwarded',
        '# TYPE ainonymous_requests_total counter',
        `ainonymous_requests_total ${stats.requestCount}`,
        '# HELP ainonymous_session_map_size Current session map entries',
        '# TYPE ainonymous_session_map_size gauge',
        `ainonymous_session_map_size ${pipeline.getSessionMap().size}`,
        '# HELP ainonymous_replacements_total Audit log entries by layer',
        '# TYPE ainonymous_replacements_total counter',
        `ainonymous_replacements_total{layer="secrets"} ${auditStats.secrets}`,
        `ainonymous_replacements_total{layer="identity"} ${auditStats.identity}`,
        `ainonymous_replacements_total{layer="code"} ${auditStats.code}`,
        `ainonymous_replacements_total{layer="rehydration"} ${auditStats.rehydrated}`,
        '# HELP ainonymous_audit_chain_broken Per-file audit chain status (1 = tampered or missing checkpoint)',
        '# TYPE ainonymous_audit_chain_broken gauge',
      ];
      for (const res of scan) {
        const val = res.status === 'ok' ? 0 : 1;
        lines.push(`ainonymous_audit_chain_broken{file="${basename(res.file)}"} ${val}`);
      }
      lines.push(
        '# HELP ainonymous_audit_chain_broken_total Files currently failing chain verification',
        '# TYPE ainonymous_audit_chain_broken_total counter',
        `ainonymous_audit_chain_broken_total ${brokenFiles.length}`,
      );
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(lines.join('\n') + '\n');
      return;
    }

    if (path === '/metrics/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          uptime_ms: Date.now() - stats.startedAt,
          requests_total: stats.requestCount,
          session_map_size: pipeline.getSessionMap().size,
          audit: auditLogger.stats(),
        }),
      );
      return;
    }

    if (path === '/dashboard') {
      serveDashboard(res, extractBearerToken(req) ?? undefined);
      return;
    }

    if (path === '/dashboard/app.js') {
      serveDashboardAsset(res, 'app.js');
      return;
    }

    if (path === '/dashboard/app.css') {
      serveDashboardAsset(res, 'app.css');
      return;
    }

    if (path === '/events') {
      serveSSE(res, auditLogger);
      return;
    }

    if (path.startsWith('/shutdown')) {
      const url = new URL(rawUrl, 'http://localhost');
      const provided = url.searchParams.get('token') ?? '';
      if (!timingSafeStringEqual(provided, shutdownToken)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'shutting_down' }));
      server.close();
      return;
    }

    if (path.startsWith('/v1/messages') || path.startsWith('/v1/chat/completions')) {
      await handleApiRequest(req, res, path);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  (server as ProxyServer).shutdownToken = shutdownToken;
  return server as ProxyServer;
}

export interface ProxyServer extends http.Server {
  shutdownToken: string;
}
