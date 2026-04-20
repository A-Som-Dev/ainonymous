import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { createProxyServer } from '../../src/proxy/server.js';
import { getDefaults } from '../../src/config/loader.js';

describe('Prometheus metric ainonymous_audit_chain_broken', () => {
  let server: Server | null = null;
  let workdir: string | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    if (workdir) {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {}
      workdir = null;
    }
  });

  it('exposes 0 when audit dir is missing', async () => {
    const config = getDefaults();
    config.behavior.auditDir = join(tmpdir(), 'ain-never-exists-' + Date.now());
    server = createProxyServer({ config });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/metrics`);
    const body = await r.text();
    expect(body).toContain('ainonymous_audit_chain_broken_total');
    expect(body).toMatch(/ainonymous_audit_chain_broken_total\s+0/);
  });

  it('exposes per-file broken gauge 1 for a tampered file', async () => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-metric-'));
    const file = join(workdir, 'ainonymous-audit-2026-04-19.jsonl');
    writeFileSync(
      file,
      JSON.stringify({
        timestamp: 1,
        layer: 'identity',
        type: 'email',
        originalHash: 'a'.repeat(32),
        context: 'email@0:10',
        seq: 0,
        prevHash: 'deadbeef',
      }) + '\n',
      'utf-8',
    );
    const config = getDefaults();
    config.behavior.auditDir = workdir;
    server = createProxyServer({ config });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/metrics`);
    const body = await r.text();
    expect(body).toMatch(/ainonymous_audit_chain_broken\{file="[^"]+"\}\s+1/);
    expect(body).toMatch(/ainonymous_audit_chain_broken_total\s+1/);
  });
});
