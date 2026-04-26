import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createProxyServer } from '../../src/proxy/server.js';
import { getDefaults } from '../../src/config/loader.js';

describe('Prometheus telemetry counters for pseudoGen and sentinel fanout', () => {
  let server: Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  async function bodyOfMetrics(): Promise<string> {
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/metrics`);
    return r.text();
  }

  it('declares ainonymous_identity_map_skips_total with initial 0', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const body = await bodyOfMetrics();
    expect(body).toContain('# TYPE ainonymous_identity_map_skips_total counter');
    expect(body).toMatch(/ainonymous_identity_map_skips_total\s+0/);
  });

  it('declares ainonymous_sentinel_fanout per sentinel pseudonym', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const body = await bodyOfMetrics();
    expect(body).toContain('# TYPE ainonymous_sentinel_fanout gauge');
    expect(body).toMatch(/ainonymous_sentinel_fanout\{pseudonym="\*{3}ANONYMIZED\*{3}"\}\s+0/);
    expect(body).toMatch(/ainonymous_sentinel_fanout\{pseudonym="\*{3}REDACTED\*{3}"\}\s+0/);
  });

  it('exposes telemetry in /metrics/json', async () => {
    const config = getDefaults();
    server = createProxyServer({ config });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/metrics/json`);
    const json = (await r.json()) as Record<string, unknown>;
    expect(json).toHaveProperty('identity_map_skips', 0);
    expect(json).toHaveProperty('sentinel_fanout');
    const fanout = json['sentinel_fanout'] as Record<string, number>;
    expect(fanout).toHaveProperty('***ANONYMIZED***', 0);
    expect(fanout).toHaveProperty('***REDACTED***', 0);
  });

  it('identity_map_skips increments after pipeline triggers an identity collision', async () => {
    const config = getDefaults();
    const { Pipeline } = await import('../../src/pipeline/pipeline.js');
    const pipeline = new Pipeline(config);
    pipeline.getPseudoGen().identifier('Alpha');
    server = createProxyServer({ config, pipeline });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/metrics/json`);
    const json = (await r.json()) as Record<string, number>;
    expect(json.identity_map_skips).toBeGreaterThan(0);
  });
});
