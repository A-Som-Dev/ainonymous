import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createProxyServer } from '../../src/proxy/server.js';
import { AuditLogger } from '../../src/audit/logger.js';
import { getDefaults } from '../../src/config/loader.js';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import type { Server } from 'node:http';

async function listenOnRandomPort(srv: Server): Promise<number> {
  await new Promise<void>((resolve) => srv.listen(0, resolve));
  const addr = srv.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

describe('createProxyServer', () => {
  let server: Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it('creates a server without crashing', () => {
    const config = getDefaults();
    server = createProxyServer({ config });
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
  });

  it('accepts an external AuditLogger', () => {
    const config = getDefaults();
    const logger = new AuditLogger();
    server = createProxyServer({ config, logger });
    expect(server).toBeDefined();
  });

  it('shares session map when an external Pipeline is provided', async () => {
    const config = getDefaults();
    const logger = new AuditLogger();
    const pipeline = new Pipeline(config, logger);
    pipeline.getSessionMap().set('Original', 'Pseudo', 'identity', 'test');
    const expected = pipeline.getSessionMap().size;

    server = createProxyServer({ config, logger, pipeline });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.sessionMapSize).toBe(expected);
  });

  it('responds to /health', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe('ok');
    expect(typeof data.uptime).toBe('number');
  });

  it('responds to /dashboard with html and strict CSP', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/dashboard`);
    expect(res.headers.get('content-type')).toContain('text/html');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    const body = await res.text();
    expect(body).toContain('AInonymity');
    expect(body).toContain('/dashboard/app.css');
    expect(body).toContain('/dashboard/app.js');
    expect(body).not.toMatch(/<script>[^<]/);
    expect(body).not.toMatch(/<style>[^<]/);
  });

  it('serves /dashboard/app.js with javascript content-type', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/dashboard/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await res.text();
    expect(body).toContain('EventSource');
  });

  it('serves /dashboard/app.css with css content-type', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/dashboard/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await res.text();
    expect(body).toContain('.card');
  });

  it('responds to /events with SSE headers', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      signal: controller.signal,
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    controller.abort();
  });

  it('accepts shutdown with valid token', async () => {
    const config = getDefaults();
    const srv = createProxyServer({ config, shutdownToken: 'test-token-abc' });
    server = srv;

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/shutdown?token=test-token-abc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe('shutting_down');
  });

  it('rejects shutdown with wrong token', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, shutdownToken: 'real-token' });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/shutdown?token=wrong-token`);
    expect(res.status).toBe(403);
  });

  it('rejects shutdown with no token', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, shutdownToken: 'real-token' });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/shutdown`);
    expect(res.status).toBe(403);
  });

  it('responds to /metrics in Prometheus text format', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('# HELP ainonymity_uptime_seconds');
    expect(text).toContain('# TYPE ainonymity_requests_total counter');
    expect(text).toMatch(/ainonymity_requests_total\s+\d+/);
  });

  it('exposes legacy JSON stats at /metrics/json', async () => {
    const config = getDefaults();
    config.behavior.auditLog = false;
    const logger = new AuditLogger();
    server = createProxyServer({ config, logger });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const { Pipeline } = await import('../../src/pipeline/pipeline.js');
    const pipeline = new Pipeline(config, logger);
    await pipeline.anonymize('password=SuperSecret123');

    const res = await fetch(`http://127.0.0.1:${port}/metrics/json`);
    const data = (await res.json()) as Record<string, unknown>;
    const audit = data.audit as Record<string, number>;
    expect(audit).not.toBeNull();
    expect(audit.total).toBeGreaterThan(0);
  });

  it('reflects audit counts in Prometheus output', async () => {
    const config = getDefaults();
    config.behavior.auditLog = false;
    const logger = new AuditLogger();
    server = createProxyServer({ config, logger });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const { Pipeline } = await import('../../src/pipeline/pipeline.js');
    const pipeline = new Pipeline(config, logger);
    await pipeline.anonymize('password=SuperSecret123');

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    const text = await res.text();
    expect(text).toMatch(/ainonymity_replacements_total\{layer="secrets"\}\s+[1-9]/);
  });

  it('returns 404 for unknown paths', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });

    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe('management endpoint auth', () => {
  const TOKEN = 'test-token-1234567';
  let server: Server | null = null;
  const ORIG_ENV = process.env['AINONYMITY_MGMT_TOKEN'];

  beforeEach(() => {
    delete process.env['AINONYMITY_MGMT_TOKEN'];
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    if (ORIG_ENV === undefined) {
      delete process.env['AINONYMITY_MGMT_TOKEN'];
    } else {
      process.env['AINONYMITY_MGMT_TOKEN'] = ORIG_ENV;
    }
  });

  it('leaves /metrics open when no mgmt token is configured', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
  });

  it('allows /metrics with correct Bearer token', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('rejects /metrics with wrong Bearer token (403 forbidden)', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: 'Bearer wrong-token-ABCDEFG' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('forbidden');
  });

  it('rejects /metrics with missing Authorization header (401 unauthorized)', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
  });

  it('rejects /metrics with malformed Authorization header (no Bearer scheme)', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` },
    });
    expect(res.status).toBe(401);
  });

  it('protects /metrics/json the same way', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/metrics/json`);
    expect(res.status).toBe(401);
  });

  it('allows /dashboard with correct Bearer token', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/dashboard`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('protects /dashboard/app.js and /dashboard/app.css', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const jsNoAuth = await fetch(`http://127.0.0.1:${port}/dashboard/app.js`);
    expect(jsNoAuth.status).toBe(401);

    const cssNoAuth = await fetch(`http://127.0.0.1:${port}/dashboard/app.css`);
    expect(cssNoAuth.status).toBe(401);

    const jsOk = await fetch(`http://127.0.0.1:${port}/dashboard/app.js`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(jsOk.status).toBe(200);
    expect(jsOk.headers.get('content-type')).toContain('application/javascript');

    const cssOk = await fetch(`http://127.0.0.1:${port}/dashboard/app.css`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(cssOk.status).toBe(200);
    expect(cssOk.headers.get('content-type')).toContain('text/css');
  });

  it('allows /events with correct Bearer token (SSE)', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    controller.abort();
  });

  it('leaves /health open even when a mgmt token is set', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });

  it('leaves /v1/messages open even when a mgmt token is set', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, upstream: 'http://127.0.0.1:1', mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('rejects wrong tokens of different lengths uniformly (timing-safe)', async () => {
    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: TOKEN });
    const port = await listenOnRandomPort(server);

    const short = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: 'Bearer x' },
    });
    const long = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: `Bearer ${'x'.repeat(64)}` },
    });

    expect(short.status).toBe(403);
    expect(long.status).toBe(403);
    const shortBody = (await short.json()) as Record<string, unknown>;
    const longBody = (await long.json()) as Record<string, unknown>;
    expect(shortBody).toEqual(longBody);
  });

  it('lets env var AINONYMITY_MGMT_TOKEN override options', async () => {
    process.env['AINONYMITY_MGMT_TOKEN'] = 'env-token-ABCDEFGHIJ';

    const config = getDefaults();
    server = createProxyServer({ config, mgmtToken: 'config-token-123' });
    const port = await listenOnRandomPort(server);

    const fromEnv = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: 'Bearer env-token-ABCDEFGHIJ' },
    });
    expect(fromEnv.status).toBe(200);

    const fromOpts = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: 'Bearer config-token-123' },
    });
    expect(fromOpts.status).toBe(403);
  });
});
