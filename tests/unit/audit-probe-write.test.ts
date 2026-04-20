import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLogger, AuditPersistError } from '../../src/audit/logger.js';

describe('AuditLogger enablePersistence probe-write', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-probe-'));
  });

  afterEach(() => {
    try {
      chmodSync(workdir, 0o700);
    } catch {}
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  it('throws AuditPersistError when audit dir is not writable under block mode', () => {
    const logger = new AuditLogger();
    const nested = join(workdir, 'already-a-file');
    writeFileSync(nested, 'blocker', 'utf-8');

    expect(() => logger.enablePersistence(nested, 'block')).toThrow(AuditPersistError);
  });

  it('leaves no probe artefact behind after a successful probe-write', () => {
    const logger = new AuditLogger();
    const sub = join(workdir, 'audit');
    mkdirSync(sub, { recursive: true });

    logger.enablePersistence(sub, 'block');

    const leftovers = readdirSync(sub).filter((n) => n.includes('probe'));
    expect(leftovers).toEqual([]);
  });

  it('under permit mode logs a warning but does not throw on unwritable dir', () => {
    const logger = new AuditLogger();
    const blocked = join(workdir, 'already-a-file');
    writeFileSync(blocked, 'blocker', 'utf-8');

    const errors: string[] = [];
    const origErr = console.error;
    console.error = (msg: string) => errors.push(msg);
    try {
      expect(() => logger.enablePersistence(blocked, 'permit')).not.toThrow();
    } finally {
      console.error = origErr;
    }
    expect(errors.some((e) => /audit.*probe/i.test(e))).toBe(true);
  });
});
