import * as https from 'node:https';
import * as http from 'node:http';
import type { ServerResponse } from 'node:http';
import { log } from '../logger.js';
import { StreamRehydrator, type StreamFormat } from './stream-rehydrator.js';

const REQUEST_TIMEOUT_MS = 30_000;
const SSE_BUFFER_MAX = 1024 * 1024;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });

export interface ForwardOptions {
  upstream: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** When set, SSE responses are reassembled per content-block before the
   *  rehydrator runs, so pseudonyms split across deltas are restored. */
  streamFormat?: StreamFormat;
  /** Max length of any pseudonym known to the rehydrator. Used to size the
   *  per-block sliding buffer. Callers should read this from the session map. */
  maxPseudoLen?: number;
  /** Opt-in: release buffered text at sentence/newline boundaries early. */
  eagerFlush?: boolean;
}

function isLocalHost(host: string): boolean {
  const bare = host.split(':')[0];
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}

export function forwardPassthrough(
  opts: {
    upstream: string;
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
  },
  clientReq: http.IncomingMessage,
  clientRes: ServerResponse,
): void {
  const url = new URL(opts.path, opts.upstream);
  if (url.protocol !== 'https:' && !isLocalHost(url.hostname)) {
    throw new Error(
      `forwarder refuses plain-http upstream ${url.host}. API credentials would be exposed.`,
    );
  }
  const transport = url.protocol === 'https:' ? https : http;
  const fwdHeaders: Record<string, string | string[]> = {};
  for (const [key, val] of Object.entries(opts.headers)) {
    if (!val) continue;
    if (key.toLowerCase() === 'host') continue;
    fwdHeaders[key] = val;
  }
  fwdHeaders['host'] = url.host;

  const upstreamReq = transport.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method,
      headers: fwdHeaders,
      agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
      timeout: REQUEST_TIMEOUT_MS,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );

  upstreamReq.on('error', (err) => {
    log.error('passthrough upstream failed', { upstream: url.origin, err: err.message });
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'application/json' });
    }
    clientRes.end(JSON.stringify({ error: 'upstream_unreachable' }));
  });

  clientReq.on('aborted', () => upstreamReq.destroy());
  clientReq.pipe(upstreamReq);
}

export function forwardWithRehydration(
  opts: ForwardOptions,
  clientRes: ServerResponse,
  rehydrateFn: (chunk: string) => string,
): void {
  const url = new URL(opts.path, opts.upstream);
  if (url.protocol !== 'https:' && !isLocalHost(url.hostname)) {
    // Defence in depth: even if someone hand-edits behavior.upstream.* to an
    // http:// URL (bypassing validate.ts) the forwarder itself refuses to
    // send the API key over plain HTTP. Localhost targets stay allowed for
    // test fixtures and local inference gateways.
    throw new Error(
      `forwarder refuses plain-http upstream ${url.host}. API credentials would be exposed. Use https:// or a localhost target.`,
    );
  }
  const transport = url.protocol === 'https:' ? https : http;

  const fwdHeaders: Record<string, string | string[]> = {};
  for (const [key, val] of Object.entries(opts.headers)) {
    if (!val) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length') continue;
    fwdHeaders[key] = val;
  }

  fwdHeaders['host'] = url.host;
  if (opts.body) {
    fwdHeaders['content-length'] = Buffer.byteLength(opts.body).toString();
  }

  const proxyReq = transport.request(
    url,
    {
      method: opts.method,
      headers: fwdHeaders,
      agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
    },
    (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] ?? '';
      const isSSE = contentType.includes('text/event-stream');

      const resHeaders = { ...proxyRes.headers };
      delete resHeaders['content-length'];

      clientRes.writeHead(proxyRes.statusCode ?? 502, resHeaders);

      if (isSSE) {
        proxyRes.setEncoding('utf-8');

        if (opts.streamFormat) {
          const safeSuffix = Math.max(64, (opts.maxPseudoLen ?? 32) * 2 + 50);
          const rh = new StreamRehydrator(opts.streamFormat, rehydrateFn, safeSuffix, {
            eagerFlush: opts.eagerFlush === true,
          });
          let bytesIn = 0;
          proxyRes.on('data', (chunk: string) => {
            bytesIn += chunk.length;
            if (bytesIn > MAX_RESPONSE_BYTES) {
              proxyRes.destroy(new Error('upstream response exceeds maximum size'));
              return;
            }
            const out = rh.push(chunk);
            if (out.length > 0) clientRes.write(out);
          });
          proxyRes.on('end', () => {
            const tail = rh.flush();
            if (tail.length > 0) clientRes.write(tail);
            clientRes.end();
          });
        } else {
          // legacy path: event-boundary replacement. Kept for callers that
          // don't supply a streamFormat (tests, non-LLM SSE passthrough).
          let sseBuffer = '';
          proxyRes.on('data', (chunk: string) => {
            sseBuffer += chunk;
            let boundary: number;
            while ((boundary = sseBuffer.indexOf('\n\n')) !== -1) {
              const event = sseBuffer.slice(0, boundary + 2);
              sseBuffer = sseBuffer.slice(boundary + 2);
              clientRes.write(rehydrateFn(event));
            }
            if (sseBuffer.length > SSE_BUFFER_MAX) {
              clientRes.write(rehydrateFn(sseBuffer));
              sseBuffer = '';
            }
          });
          proxyRes.on('end', () => {
            if (sseBuffer.length > 0) {
              clientRes.write(rehydrateFn(sseBuffer));
            }
            clientRes.end();
          });
        }
      } else {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let aborted = false;
        proxyRes.on('data', (chunk: Buffer) => {
          if (aborted) return;
          totalBytes += chunk.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            aborted = true;
            proxyRes.destroy(new Error('upstream response exceeds maximum size'));
            return;
          }
          chunks.push(chunk);
        });
        proxyRes.on('end', () => {
          if (aborted) return;
          const raw = Buffer.concat(chunks).toString('utf-8');
          const rehydrated = rehydrateFn(raw);
          clientRes.end(rehydrated);
        });
        proxyRes.on('error', (err) => {
          if (!clientRes.headersSent) {
            clientRes.writeHead(502, { 'content-type': 'application/json' });
          }
          clientRes.end(JSON.stringify({ error: 'upstream_error' }));
          log.error('upstream response error', { err: err.message });
        });
      }
    },
  );

  proxyReq.setTimeout(REQUEST_TIMEOUT_MS, () => {
    proxyReq.destroy(new Error('upstream request timed out'));
  });

  proxyReq.on('error', (err) => {
    log.error('upstream request failed', { upstream: opts.upstream, err: err.message });
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'application/json' });
    }
    clientRes.end(JSON.stringify({ error: 'upstream_error' }));
  });

  if (typeof clientRes.on === 'function') {
    clientRes.on('close', () => {
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });
  }

  if (opts.body) {
    proxyReq.write(opts.body);
  }
  proxyReq.end();
}
