import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProxyServer, type ProxyServer } from '../../src/proxy/server.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('oauth passthrough', () => {
  let upstream: http.Server;
  let upstreamUrl: string;
  const upstreamHits: Array<{
    path: string;
    method: string;
    auth: string | undefined;
    body: string;
  }> = [];

  beforeAll(async () => {
    await initParser();
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf-8')));
      req.on('end', () => {
        upstreamHits.push({
          path: req.url ?? '',
          method: req.method ?? 'GET',
          auth: req.headers['authorization'] as string | undefined,
          body,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, echoed: body }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    upstream.close();
  });

  async function startProxy(passthrough: boolean): Promise<{
    server: ProxyServer;
    url: string;
  }> {
    const defaults = getDefaults();
    const cfg = {
      ...defaults,
      behavior: {
        ...defaults.behavior,
        oauthPassthrough: passthrough,
        upstream: { anthropic: upstreamUrl, openai: upstreamUrl },
      },
    };
    const server = createProxyServer({ config: cfg, upstream: upstreamUrl });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { server, url };
  }

  async function request(
    url: string,
    path: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(path, url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method,
          headers: { ...headers, ...(body ? { 'content-length': String(body.length) } : {}) },
        },
        (res) => {
          let buf = '';
          res.on('data', (c: Buffer) => (buf += c.toString('utf-8')));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
        },
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  it('forwards bearer token untouched on a non-messages path when passthrough is on', async () => {
    upstreamHits.length = 0;
    const { server, url } = await startProxy(true);
    try {
      const r = await request(url, '/v1/organizations', 'GET', {
        authorization: 'Bearer sk-ant-oat01-testtoken-xyz',
      });
      expect(r.status).toBe(200);
      expect(upstreamHits).toHaveLength(1);
      expect(upstreamHits[0].path).toBe('/v1/organizations');
      expect(upstreamHits[0].auth).toBe('Bearer sk-ant-oat01-testtoken-xyz');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns 404 on non-messages path when passthrough is off', async () => {
    upstreamHits.length = 0;
    const { server, url } = await startProxy(false);
    try {
      const r = await request(url, '/v1/organizations', 'GET', {
        authorization: 'Bearer sk-ant-oat01-testtoken-xyz',
      });
      expect(r.status).toBe(404);
      expect(upstreamHits).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not anonymize passthrough request body', async () => {
    upstreamHits.length = 0;
    const { server, url } = await startProxy(true);
    try {
      const payload = JSON.stringify({ refresh_token: 'rt_secret_xyz', org: 'AcmeCorp' });
      const r = await request(
        url,
        '/v1/oauth/refresh',
        'POST',
        { authorization: 'Bearer tok', 'content-type': 'application/json' },
        payload,
      );
      expect(r.status).toBe(200);
      expect(upstreamHits[0].body).toBe(payload);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('still routes /v1/messages through the anonymizing handler when passthrough is on', async () => {
    upstreamHits.length = 0;
    const { server, url } = await startProxy(true);
    try {
      const payload = JSON.stringify({
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const r = await request(
        url,
        '/v1/messages',
        'POST',
        { authorization: 'Bearer tok', 'content-type': 'application/json' },
        payload,
      );
      expect(r.status).toBe(200);
      expect(upstreamHits[0].path).toBe('/v1/messages');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
