import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createProxyServer } from '../../src/proxy/server.js';
import { getDefaults } from '../../src/config/loader.js';

describe('proxy server boot log', () => {
  let server: Server | null = null;
  const writes: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    process.stdout.write = origWrite;
    writes.length = 0;
  });

  it('emits audit posture line containing failure mode and compliance', () => {
    writes.length = 0;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    const config = getDefaults();
    config.behavior.compliance = 'gdpr';
    config.behavior.auditLog = true;
    config.behavior.auditFailure = 'block';
    server = createProxyServer({ config });

    const joined = writes.join('');
    expect(joined).toMatch(/audit_posture/);
    expect(joined).toMatch(/"audit_failure":"block"/);
    expect(joined).toMatch(/"compliance":"gdpr"/);
    expect(joined).toMatch(/"audit_log":true/);
  });

  it('reports compliance=none when the preset is unset', () => {
    writes.length = 0;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    const config = getDefaults();
    config.behavior.compliance = undefined;
    server = createProxyServer({ config });

    expect(writes.join('')).toMatch(/"compliance":"none"/);
  });
});
