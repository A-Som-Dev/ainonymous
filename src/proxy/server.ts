import * as http from 'node:http';
import * as crypto from 'node:crypto';
import type { AInonymityConfig, ApiFormat } from '../types.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { AuditLogger } from '../audit/logger.js';
import { serveDashboard, serveDashboardAsset, serveSSE } from '../audit/dashboard.js';
import { collectBody, parseRequest, replaceTextInJson, detectApiFormat } from './interceptor.js';
import { forwardWithRehydration } from './forwarder.js';
import { anonymizeHeaders } from './header-anonymizer.js';
import { log } from '../logger.js';

interface ProxyServerOptions {
  config: AInonymityConfig;
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
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
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
      'www-authenticate': 'Bearer realm="ainonymity"',
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
    const dir = opts.config.behavior.auditDir || './ainonymity-audit';
    auditLogger.enablePersistence(dir);
  }

  const pipeline = opts.pipeline ?? new Pipeline(opts.config, auditLogger);
  const stats: ProxyStats = { requestCount: 0, startedAt: Date.now() };
  const upstreamCfg = opts.config.behavior.upstream;
  const shutdownToken = opts.shutdownToken ?? crypto.randomBytes(16).toString('hex');

  const envMgmt = process.env['AINONYMITY_MGMT_TOKEN']?.trim();
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

      const anonymizedBody = await replaceTextInJson(parsed.body, async (text) => {
        const result = await pipeline.anonymize(text);
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
        (chunk) => pipeline.rehydrate(chunk),
      );
    } catch (err) {
      log.error('proxy request failed', {
        path,
        err: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'proxy_error' }));
    }
  }

  const server = http.createServer(async (req, res) => {
    const path = req.url ?? '/';

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
      const lines = [
        '# HELP ainonymity_uptime_seconds Proxy uptime',
        '# TYPE ainonymity_uptime_seconds gauge',
        `ainonymity_uptime_seconds ${((Date.now() - stats.startedAt) / 1000).toFixed(3)}`,
        '# HELP ainonymity_requests_total API requests forwarded',
        '# TYPE ainonymity_requests_total counter',
        `ainonymity_requests_total ${stats.requestCount}`,
        '# HELP ainonymity_session_map_size Current session map entries',
        '# TYPE ainonymity_session_map_size gauge',
        `ainonymity_session_map_size ${pipeline.getSessionMap().size}`,
        '# HELP ainonymity_replacements_total Audit log entries by layer',
        '# TYPE ainonymity_replacements_total counter',
        `ainonymity_replacements_total{layer="secrets"} ${auditStats.secrets}`,
        `ainonymity_replacements_total{layer="identity"} ${auditStats.identity}`,
        `ainonymity_replacements_total{layer="code"} ${auditStats.code}`,
      ];
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
      serveDashboard(res);
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
      const url = new URL(path, 'http://localhost');
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
