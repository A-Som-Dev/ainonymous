import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { AuditLogger } from '../../src/audit/logger.js';

describe('AuditLogger sentinel flag', () => {
  it('marks log entries whose pseudonym is the anonymized sentinel', () => {
    const logger = new AuditLogger();
    logger.log({
      original: 'ssn-1',
      pseudonym: '***ANONYMIZED***',
      layer: 'identity',
      type: 'ssn',
      offset: 0,
      length: 5,
    });
    logger.log({
      original: 'a@example.com',
      pseudonym: 'user1@company-alpha.com',
      layer: 'identity',
      type: 'email',
      offset: 0,
      length: 13,
    });

    const e = logger.entries();
    expect(e[0].sentinel).toBe(true);
    expect(e[1].sentinel).toBeUndefined();
  });
});

describe('audit pending CLI splits sentinel-only from rehydration-pending', () => {
  let workdir: string;
  const cliPath = join(process.cwd(), 'dist', 'cli', 'index.js');

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-pend-sentinel-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('counts sentinel-only originals in the summary line', () => {
    const logger = new AuditLogger();
    logger.enablePersistence(workdir, 'permit');
    logger.log({
      original: 'ssn-alpha',
      pseudonym: '***ANONYMIZED***',
      layer: 'identity',
      type: 'ssn',
      offset: 0,
      length: 9,
    });
    logger.log({
      original: 'ssn-beta',
      pseudonym: '***ANONYMIZED***',
      layer: 'identity',
      type: 'ssn',
      offset: 10,
      length: 9,
    });
    logger.log({
      original: 'user@acme.com',
      pseudonym: 'user1@company-alpha.com',
      layer: 'identity',
      type: 'email',
      offset: 20,
      length: 13,
    });

    const out = execSync(`node "${cliPath}" audit pending --dir "${workdir}"`, {
      encoding: 'utf-8',
      env: process.env,
    });

    expect(out).toMatch(/sentinel[- ]only/i);
    expect(out).toMatch(/2/);
  });
});
