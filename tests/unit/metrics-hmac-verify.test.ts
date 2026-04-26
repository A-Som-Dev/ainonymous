import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { AuditLogger } from '../../src/audit/logger.js';
import { createProxyServer } from '../../src/proxy/server.js';
import { getDefaults } from '../../src/config/loader.js';

const ENV_KEY = 'AINONYMOUS_AUDIT_HMAC_KEY';

describe('Prometheus counter ainonymous_audit_hmac_verify_failures_total', () => {
  let server: Server | null = null;
  let workdir: string;
  let originalKey: string | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-metric-hmac-'));
    originalKey = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalKey;
    if (server) {
      server.close();
      server = null;
    }
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  async function metricsBody(): Promise<string> {
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/metrics`);
    return r.text();
  }

  it('reports 0 when all hmac-protected files verify cleanly', async () => {
    process.env[ENV_KEY] = randomBytes(32).toString('base64');
    const logger = new AuditLogger();
    logger.enablePersistence(workdir);
    logger.log({
      original: 'a',
      pseudonym: 'Alpha',
      layer: 'identity',
      type: 'person-name',
      offset: 0,
      length: 1,
    });
    const config = getDefaults();
    config.behavior.auditDir = workdir;
    server = createProxyServer({ config });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const body = await metricsBody();
    expect(body).toContain('# TYPE ainonymous_audit_hmac_verify_failures_total counter');
    expect(body).toMatch(/ainonymous_audit_hmac_verify_failures_total\s+0/);
  });

  it('counts each tampered hmac sidecar', async () => {
    process.env[ENV_KEY] = randomBytes(32).toString('base64');
    const logger = new AuditLogger();
    logger.enablePersistence(workdir);
    logger.log({
      original: 'a',
      pseudonym: 'Alpha',
      layer: 'identity',
      type: 'person-name',
      offset: 0,
      length: 1,
    });
    // Tamper the sidecar
    const hmacFile = join(
      workdir,
      `ainonymous-audit-${new Date().toISOString().slice(0, 10)}.jsonl.hmac`,
    );
    writeFileSync(hmacFile, '{"seq":0,"kid":"default","mac":"deadbeef"}\n', 'utf-8');
    const config = getDefaults();
    config.behavior.auditDir = workdir;
    server = createProxyServer({ config });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const body = await metricsBody();
    expect(body).toMatch(/ainonymous_audit_hmac_verify_failures_total\s+1/);
  });
});
