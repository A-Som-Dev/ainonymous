import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { createProxyServer } from '../../src/proxy/server.js';
import { AuditLogger } from '../../src/audit/logger.js';
import { getDefaults } from '../../src/config/loader.js';

describe('E2E proxy flow', () => {
  let upstream: http.Server | null = null;
  let proxy: http.Server | null = null;

  afterEach(async () => {
    if (proxy) await new Promise<void>((r) => proxy!.close(() => r()));
    if (upstream) await new Promise<void>((r) => upstream!.close(() => r()));
    proxy = null;
    upstream = null;
  });

  it('anonymizes request and rehydrates response', async () => {
    // Mock upstream echoes the user message back
    let upstreamBody = '';
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        upstreamBody = Buffer.concat(chunks).toString('utf-8');
        res.writeHead(200, { 'content-type': 'application/json' });
        const parsed = JSON.parse(upstreamBody);
        const userMsg = parsed.messages[0].content;
        res.end(
          JSON.stringify({
            content: [{ type: 'text', text: 'I see: ' + userMsg.slice(0, 200) }],
          }),
        );
      });
    });

    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r));
    const upPort = (upstream!.address() as any).port;

    const config = getDefaults();
    config.identity.company = 'Acme Corp';
    config.identity.domains = ['acme-corp.com'];
    config.identity.people = ['Artur Sommer'];
    config.behavior.upstream.anthropic = `http://127.0.0.1:${upPort}`;
    config.behavior.auditLog = false;

    const logger = new AuditLogger();
    proxy = createProxyServer({ config, logger });

    await new Promise<void>((r) => proxy!.listen(0, '127.0.0.1', r));
    const proxyPort = (proxy!.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content:
              'Fix the code by Artur Sommer at Acme Corp. Email: artur@acme-corp.com. Password: SuperSecret123!',
          },
        ],
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    // Upstream must NOT see originals
    expect(upstreamBody).not.toContain('Artur Sommer');
    expect(upstreamBody).not.toContain('Acme Corp');
    expect(upstreamBody).not.toContain('acme-corp.com');
    expect(upstreamBody).not.toContain('SuperSecret123');

    // Upstream SHOULD see redaction markers
    expect(upstreamBody).toContain('REDACTED');

    // Audit logged findings
    expect(logger.stats().total).toBeGreaterThan(0);

    // Response is valid
    expect(data).toHaveProperty('content');
  }, 15000);

  it('forwards auth headers verbatim but anonymizes custom context headers', async () => {
    let upstreamHeaders: Record<string, string | string[] | undefined> = {};
    upstream = http.createServer((req, res) => {
      upstreamHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }));
      });
    });

    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r));
    const upPort = (upstream!.address() as { port: number }).port;

    const config = getDefaults();
    config.identity.company = 'AsomGmbH';
    config.identity.domains = ['asom.de'];
    config.identity.people = ['Artur Sommer'];
    config.behavior.upstream.anthropic = `http://127.0.0.1:${upPort}`;
    config.behavior.auditLog = false;

    const logger = new AuditLogger();
    proxy = createProxyServer({ config, logger });
    await new Promise<void>((r) => proxy!.listen(0, '127.0.0.1', r));
    const proxyPort = (proxy!.address() as { port: number }).port;

    await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-ant-realAuthToken999',
        'x-api-key': 'sk-ant-keep-me-intact',
        'anthropic-version': '2023-06-01',
        'x-company': 'AsomGmbH',
        'x-user-email': 'user@asom.de',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(upstreamHeaders['authorization']).toBe('Bearer sk-ant-realAuthToken999');
    expect(upstreamHeaders['x-api-key']).toBe('sk-ant-keep-me-intact');
    expect(upstreamHeaders['anthropic-version']).toBe('2023-06-01');

    const xCompany = upstreamHeaders['x-company'] as string | undefined;
    expect(xCompany).toBeDefined();
    expect(xCompany).not.toBe('AsomGmbH');
    expect(xCompany).not.toContain('AsomGmbH');

    const xEmail = upstreamHeaders['x-user-email'] as string | undefined;
    expect(xEmail).toBeDefined();
    expect(xEmail).not.toContain('user@asom.de');
    expect(xEmail).not.toContain('asom.de');

    const auditDump = JSON.stringify(logger.entries());
    expect(auditDump).not.toContain('sk-ant-realAuthToken999');
    expect(auditDump).not.toContain('sk-ant-keep-me-intact');
  }, 15000);

  it('returns REDACTED to client when upstream echoes it in an error body, without leaking identity upstream', async () => {
    // Upstream returns 500 with a body that itself contains ***REDACTED*** markers.
    // Verify:
    //   1. the proxy does not un-redact the secret marker
    //   2. no original identity (Artur Sommer, Acme Corp) reached the upstream
    //   3. no original secret (hunter2secretpass) reached the upstream
    let capturedUpstreamBody = '';
    upstream = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        capturedUpstreamBody = data;
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'bad request',
            debug: 'upstream saw: password=***REDACTED*** sent by unknown client',
          }),
        );
      });
    });
    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r));
    const upPort = (upstream!.address() as { port: number }).port;

    const config = getDefaults();
    config.identity.company = 'Acme Corp';
    config.identity.people = ['Artur Sommer'];
    config.behavior.upstream.anthropic = `http://127.0.0.1:${upPort}`;
    config.behavior.auditLog = false;

    proxy = createProxyServer({ config, logger: new AuditLogger() });
    await new Promise<void>((r) => proxy!.listen(0, '127.0.0.1', r));
    const proxyPort = (proxy!.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: 'test',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: 'Hi from Artur Sommer at Acme Corp. password=hunter2secretpass',
          },
        ],
      }),
    });

    const body = await res.text();
    // client-facing behaviour
    expect(body).toContain('***REDACTED***');
    expect(body).not.toContain('hunter2secretpass');

    // upstream-facing anonymization. the actual identity protection contract
    expect(capturedUpstreamBody).not.toContain('Artur Sommer');
    expect(capturedUpstreamBody).not.toContain('Acme Corp');
    expect(capturedUpstreamBody).not.toContain('hunter2secretpass');
  }, 15000);
});
