import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { AuditLogger } from '../../src/audit/logger.js';

const ENV_KEY = 'AINONYMOUS_AUDIT_HMAC_KEY';
const cliPath = join(process.cwd(), 'dist', 'cli', 'index.js');

function todayLogFile(dir: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return join(dir, `ainonymous-audit-${stamp}.jsonl`);
}

describe('audit pending reports tamper-impacted entries separately', () => {
  let workdir: string;
  let originalKey: string | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-pend-cat-'));
    originalKey = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalKey;
    rmSync(workdir, { recursive: true, force: true });
  });

  it('flags HMAC-tampered files under a dedicated section', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('base64');
    const logger = new AuditLogger();
    logger.enablePersistence(workdir, 'permit');
    logger.log({
      original: 'email-alpha@acme.com',
      pseudonym: 'user1@company-alpha.com',
      layer: 'identity',
      type: 'email',
      offset: 0,
      length: 13,
    });
    // Break the sidecar MAC so verify fails with sidecar-mac-mismatch.
    const hmac = todayLogFile(workdir) + '.hmac';
    writeFileSync(hmac, '{"seq":0,"kid":"default","mac":"deadbeef"}\n', 'utf-8');

    const out = execSync(`node "${cliPath}" audit pending --dir "${workdir}"`, {
      encoding: 'utf-8',
      env: process.env,
    });

    expect(out).toMatch(/tamper[- ]impacted/i);
    expect(out).toMatch(/hmac/i);
  });

  it('still shows 0 rehydration-pending when all non-tampered originals were rehydrated', () => {
    const logger = new AuditLogger();
    logger.enablePersistence(workdir, 'permit');
    logger.log({
      original: 'only-anon',
      pseudonym: '***ANONYMIZED***',
      layer: 'identity',
      type: 'ssn',
      offset: 0,
      length: 9,
    });

    const out = execSync(`node "${cliPath}" audit pending --dir "${workdir}"`, {
      encoding: 'utf-8',
      env: process.env,
    });

    expect(out).toMatch(/0 rehydration[- ]pending/i);
    expect(out).toMatch(/1 sentinel[- ]only/i);
  });
});
