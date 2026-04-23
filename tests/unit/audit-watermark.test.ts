import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  AuditLogger,
  getWatermarkPath,
  resetWatermarkSkipNoticeForTests,
} from '../../src/audit/logger.js';

const ENV_KEY = 'AINONYMOUS_AUDIT_HMAC_KEY';
const HOME_OVERRIDE = 'AINONYMOUS_STATE_HOME';

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

describe('audit external watermark', () => {
  let workdir: string;
  let stateHome: string;
  let originalKey: string | undefined;
  let originalHome: string | undefined;
  let originalErr: typeof console.error;
  const errors: string[] = [];

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-wm-audit-'));
    stateHome = mkdtempSync(join(tmpdir(), 'ain-wm-home-'));
    originalKey = process.env[ENV_KEY];
    originalHome = process.env[HOME_OVERRIDE];
    process.env[HOME_OVERRIDE] = stateHome;
    originalErr = console.error;
    errors.length = 0;
    console.error = (msg: unknown, ...rest: unknown[]): void => {
      errors.push([msg, ...rest].map(String).join(' '));
    };
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalKey;
    if (originalHome === undefined) delete process.env[HOME_OVERRIDE];
    else process.env[HOME_OVERRIDE] = originalHome;
    console.error = originalErr;
    try {
      rmSync(workdir, { recursive: true, force: true });
      rmSync(stateHome, { recursive: true, force: true });
    } catch {}
  });

  it('writes a watermark file outside the audit dir after persisting an entry', () => {
    process.env[ENV_KEY] = makeKey();
    const logger = new AuditLogger();
    logger.enablePersistence(workdir);
    logOnce(logger, 'a');

    const wmPath = getWatermarkPath(workdir);
    expect(existsSync(wmPath)).toBe(true);
    expect(wmPath.startsWith(stateHome)).toBe(true);
  });

  it('refuses an atomic 3-tuple rollback because the external watermark advanced', () => {
    process.env[ENV_KEY] = makeKey();

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');
    const jsonl = jsonlPath(workdir);

    // Snapshot the entire 3-tuple at seq=0.
    const snap = {
      jsonl: readFileSync(jsonl),
      ckpt: readFileSync(jsonl + '.checkpoint'),
      sig: readFileSync(jsonl + '.checkpoint.hmac'),
      hmac: readFileSync(jsonl + '.hmac'),
    };

    // Advance the chain - watermark now sits at seq>=4.
    for (let i = 0; i < 4; i++) logOnce(writer, `n-${i}`);

    // Atomic rollback - all three audit-dir artefacts go back to seq=0.
    writeFileSync(jsonl, snap.jsonl);
    writeFileSync(jsonl + '.checkpoint', snap.ckpt);
    writeFileSync(jsonl + '.checkpoint.hmac', snap.sig);
    writeFileSync(jsonl + '.hmac', snap.hmac);

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) =>
        /watermark|rollback|external|state.*ahead|refus/i.test(e),
      ),
    ).toBe(true);
  });

  it('seeds normally when the watermark matches the checkpoint', () => {
    process.env[ENV_KEY] = makeKey();

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    for (let i = 0; i < 3; i++) logOnce(writer, `e-${i}`);

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);
    logOnce(restart, 'after-restart');

    const jsonl = jsonlPath(workdir);
    const lines = readFileSync(jsonl, 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]) as { seq: number };
    expect(last.seq).toBe(3);
  });

  it('refuses when an attacker deletes the watermark file but the audit dir still has entries', () => {
    process.env[ENV_KEY] = makeKey();

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    for (let i = 0; i < 3; i++) logOnce(writer, `e-${i}`);

    const wmPath = getWatermarkPath(workdir);
    rmSync(wmPath);

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /watermark.*(missing|deleted|refus)/i.test(e)),
    ).toBe(true);
  });

  it('still allows a clean first boot (no jsonl, no watermark) without complaining', () => {
    process.env[ENV_KEY] = makeKey();
    const fresh = new AuditLogger();
    fresh.enablePersistence(workdir);
    expect(
      errors.some((e) => /watermark.*(missing|deleted|refus)/i.test(e)),
    ).toBe(false);
  });

  it('AINONYMOUS_AUDIT_NO_WATERMARK does not bypass watermark verification when one exists', () => {
    process.env[ENV_KEY] = makeKey();
    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');

    process.env['AINONYMOUS_AUDIT_NO_WATERMARK'] = '1';
    try {
      const wmPath = getWatermarkPath(workdir);
      const wm = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
      wm.mac = 'a'.repeat(64);
      writeFileSync(wmPath, JSON.stringify(wm), 'utf-8');

      const restart = new AuditLogger();
      restart.enablePersistence(workdir);

      expect(
        errors.some((e) => /watermark.*(mac|signature|mismatch|refus)/i.test(e)),
      ).toBe(true);
    } finally {
      delete process.env['AINONYMOUS_AUDIT_NO_WATERMARK'];
    }
  });

  it('survives a torn watermark write by writing through a temp + rename', () => {
    process.env[ENV_KEY] = makeKey();
    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');

    const wmPath = getWatermarkPath(workdir);
    writeFileSync(wmPath, '{"audit_dir":"/x","max_seq', 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /watermark.*(corrupt|unreadable|truncat|refus)/i.test(e)),
    ).toBe(true);
  });

  it('refuses a watermark with an unsupported schema version', () => {
    const key = makeKey();
    process.env[ENV_KEY] = key;

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');

    const wmPath = getWatermarkPath(workdir);
    const wm = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
    wm.v = 99;
    writeFileSync(wmPath, JSON.stringify(wm), 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /watermark.*(version|schema|99|refus)/i.test(e)),
    ).toBe(true);
  });

  it('emits a one-shot NOTICE when AINONYMOUS_AUDIT_NO_WATERMARK skips a write', () => {
    process.env[ENV_KEY] = makeKey();
    process.env['AINONYMOUS_AUDIT_NO_WATERMARK'] = '1';
    resetWatermarkSkipNoticeForTests();
    try {
      const writer = new AuditLogger();
      writer.enablePersistence(workdir);
      logOnce(writer, 'a');
      logOnce(writer, 'b');

      const noticeCount = errors.filter((e) =>
        /AINONYMOUS_AUDIT_NO_WATERMARK.*skipping/i.test(e),
      ).length;
      expect(noticeCount).toBe(1);
    } finally {
      delete process.env['AINONYMOUS_AUDIT_NO_WATERMARK'];
    }
  });

  it('triggers the wm-MAC gate when kid/mac are missing under HMAC mode', () => {
    process.env[ENV_KEY] = makeKey();
    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    for (let i = 0; i < 3; i++) logOnce(writer, `e-${i}`);

    // Leave jsonl, ckpt and ckpt.hmac untouched so the checkpoint MAC v=2
    // verifies cleanly. Only forge the watermark by stripping its kid+mac.
    // That isolates the watermark-MAC gate ("missing signature while HMAC
    // is configured") from the checkpoint-MAC gate further up.
    const wmPath = getWatermarkPath(workdir);
    const wm = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
    delete wm.kid;
    delete wm.mac;
    writeFileSync(wmPath, JSON.stringify(wm), 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /watermark.*(missing.*signature|HMAC is configured)/i.test(e)),
    ).toBe(true);
  });

  it('refuses when the watermark MAC does not verify (HMAC mode)', () => {
    process.env[ENV_KEY] = makeKey();

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');

    const wmPath = getWatermarkPath(workdir);
    const wm = JSON.parse(readFileSync(wmPath, 'utf-8')) as Record<string, unknown>;
    wm.mac = 'a'.repeat(64);
    writeFileSync(wmPath, JSON.stringify(wm), 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /watermark.*(mac|signature|mismatch|refus)/i.test(e)),
    ).toBe(true);
  });
});
