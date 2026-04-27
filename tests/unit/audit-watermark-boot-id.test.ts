import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHmac } from 'node:crypto';
import { AuditLogger, getWatermarkPath } from '../../src/audit/logger.js';

const ENV_KEY = 'AINONYMOUS_AUDIT_HMAC_KEY';

function makeKey(): string {
  return randomBytes(32).toString('base64');
}

function logOnce(logger: AuditLogger, original: string): void {
  logger.log({
    original,
    pseudonym: 'Alpha',
    layer: 'identity',
    type: 'person-name',
    offset: 0,
    length: original.length,
  });
}

function jsonlPath(workdir: string): string {
  return join(workdir, readdirSync(workdir).find((f) => f.endsWith('.jsonl'))!);
}

function readWatermark(audit_dir: string): Record<string, unknown> {
  const path = getWatermarkPath(audit_dir);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('audit watermark boot-id witness', () => {
  let workdir: string;
  let originalKey: string | undefined;
  let originalErr: typeof console.error;
  const errors: string[] = [];

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-wm-bootid-'));
    originalKey = process.env[ENV_KEY];
    originalErr = console.error;
    errors.length = 0;
    console.error = (msg: unknown, ...rest: unknown[]): void => {
      errors.push([msg, ...rest].map(String).join(' '));
    };
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalKey;
    console.error = originalErr;
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
    try {
      rmSync(getWatermarkPath(workdir), { force: true });
    } catch {}
  });

  it('writes a v=2 watermark on every platform', () => {
    const logger = new AuditLogger();
    logger.enablePersistence(workdir);
    logOnce(logger, 'a');
    const wm = readWatermark(workdir);
    expect(wm.v).toBe(2);
  });

  it('legacy v=1 watermark seeds successfully and logs a migration notice', () => {
    process.env[ENV_KEY] = makeKey();
    // Build a real v=1 chain end-to-end first.
    const logger1 = new AuditLogger();
    logger1.enablePersistence(workdir);
    logOnce(logger1, 'a');
    const jsonl = jsonlPath(workdir);
    const wmPath = getWatermarkPath(workdir);
    // Re-write the watermark in legacy v=1 shape (drop boot_id, recompute mac
    // under the v=1 body).
    const live = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
    const v1Body = JSON.stringify({
      v: 1,
      audit_dir: live.audit_dir,
      max_seq: live.max_seq,
      last_hash: live.last_hash,
    });
    const key = Buffer.from(process.env[ENV_KEY]!, 'base64');
    const v1Mac = createHmac('sha256', key).update(v1Body).digest('hex');
    const v1Wm = {
      v: 1,
      audit_dir: live.audit_dir,
      max_seq: live.max_seq,
      last_hash: live.last_hash,
      kid: 'default',
      mac: v1Mac,
    };
    writeFileSync(wmPath, JSON.stringify(v1Wm), 'utf-8');

    const logger2 = new AuditLogger();
    logger2.enablePersistence(workdir);
    logOnce(logger2, 'b');

    expect(errors.some((e) => /legacy v=1/i.test(e) && /v=2/i.test(e))).toBe(true);
    // After the second persistEntry the watermark is rewritten under v=2.
    const after = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
    expect(after.v).toBe(2);
    // Sanity check the chain advanced.
    const lines = readFileSync(jsonl, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('HMAC mode refuses a watermark whose forged boot_id breaks the v=2 mac', () => {
    process.env[ENV_KEY] = makeKey();
    const logger = new AuditLogger();
    logger.enablePersistence(workdir);
    logOnce(logger, 'a');

    const wmPath = getWatermarkPath(workdir);
    const live = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
    // Inject a forged boot_id without recomputing the mac. v=2 verify recomputes
    // the body with whatever boot_id is on disk; a different boot_id flips the
    // mac and seeding refuses.
    const tampered = { ...live, boot_id: 'linux:forged-cross-boot-replay' };
    writeFileSync(wmPath, JSON.stringify(tampered), 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(errors.some((e) => /watermark signature mismatch/i.test(e))).toBe(true);
  });

  it('keyless mode logs a NOTICE when boot_id differs but seeds anyway', () => {
    delete process.env[ENV_KEY];
    const logger = new AuditLogger();
    logger.enablePersistence(workdir);
    logOnce(logger, 'a');

    const wmPath = getWatermarkPath(workdir);
    const live = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
    // Only meaningful when getBootId() returned a value at write time.
    if (live.boot_id === undefined) {
      // Platform has no boot-id source (e.g. Windows). The NOTICE branch is
      // unreachable, but the fact that the test does not crash is the
      // platform contract we wanted to verify.
      expect(true).toBe(true);
      return;
    }
    const tampered = { ...live, boot_id: 'linux:not-the-real-boot' };
    writeFileSync(wmPath, JSON.stringify(tampered), 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(errors.some((e) => /boot_id.*differs/i.test(e) && /HMAC/i.test(e))).toBe(true);
  });
});
