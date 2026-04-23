import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

describe('audit checkpoint replay defense', () => {
  let workdir: string;
  let originalKey: string | undefined;
  let originalErr: typeof console.error;
  const errors: string[] = [];

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-ckpt-replay-'));
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
  });

  it('refuses replay of an older checkpoint+sidecar pair from the same file', () => {
    process.env[ENV_KEY] = makeKey();

    const writer1 = new AuditLogger();
    writer1.enablePersistence(workdir);
    logOnce(writer1, 'a');
    const jsonl = jsonlPath(workdir);
    // Snapshot the checkpoint+sidecar at seq=0 (the "old" pair to replay later).
    const oldCkpt = readFileSync(jsonl + '.checkpoint');
    const oldSig = readFileSync(jsonl + '.checkpoint.hmac');

    // Continue writing - chain advances to seq=4.
    for (let i = 0; i < 4; i++) logOnce(writer1, `next-${i}`);

    // Attacker rolls back the checkpoint pair to the seq=0 snapshot.
    writeFileSync(jsonl + '.checkpoint', oldCkpt);
    writeFileSync(jsonl + '.checkpoint.hmac', oldSig);

    // Restart the logger and observe seed behaviour.
    const writer2 = new AuditLogger();
    writer2.enablePersistence(workdir);

    expect(
      errors.some((e) => /checkpoint.*(replay|rollback|stale|refus)/i.test(e)),
    ).toBe(true);
  });

  it('refuses a sidecar whose MAC body was bound to a different file basename', () => {
    const key = randomBytes(32).toString('base64');
    process.env[ENV_KEY] = key;

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');
    const jsonl = jsonlPath(workdir);
    const ckptRaw = readFileSync(jsonl + '.checkpoint', 'utf-8');

    // Re-sign the existing checkpoint blob under a body that pretends the
    // checkpoint belongs to a sibling file. This is what a one-shot writer
    // would do if they swapped sidecars across daily files.
    const keyBuf = Buffer.from(key, 'base64');
    const forgedBody = JSON.stringify({
      v: 2,
      ckpt: ckptRaw,
      seq: 0,
      file: 'ainonymous-audit-1999-01-01.jsonl',
    });
    const forgedMac = createHmac('sha256', keyBuf).update(forgedBody).digest('hex');
    writeFileSync(
      jsonl + '.checkpoint.hmac',
      JSON.stringify({ v: 2, kid: 'default', mac: forgedMac }),
      'utf-8',
    );

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /checkpoint.*(mismatch|refus)/i.test(e)),
    ).toBe(true);
  });

  it('rejects same-file rollback even without an HMAC key configured', () => {
    delete process.env[ENV_KEY];

    const writer1 = new AuditLogger();
    writer1.enablePersistence(workdir);
    logOnce(writer1, 'a');
    const jsonl = jsonlPath(workdir);
    const oldCkpt = readFileSync(jsonl + '.checkpoint');

    for (let i = 0; i < 3; i++) logOnce(writer1, `n-${i}`);

    writeFileSync(jsonl + '.checkpoint', oldCkpt);

    const writer2 = new AuditLogger();
    writer2.enablePersistence(workdir);

    expect(
      errors.some((e) => /checkpoint.*(stale|replay|behind|refus)/i.test(e)),
    ).toBe(true);
  });

  it('warns the operator that keyless persistence has no cross-file replay defence', () => {
    delete process.env[ENV_KEY];

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) =>
        /(advisory|configure.*AINONYMOUS_AUDIT_HMAC_KEY|no.*hmac|cross-file)/i.test(e),
      ),
    ).toBe(true);
  });

  it('refuses a v=1 sidecar even if the blob-only mac verifies', () => {
    const key = randomBytes(32).toString('base64');
    process.env[ENV_KEY] = key;

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');
    const jsonl = jsonlPath(workdir);
    const ckptRaw = readFileSync(jsonl + '.checkpoint', 'utf-8');

    // Synthesize a legacy v=1 sidecar that signs only the blob.
    const keyBuf = Buffer.from(key, 'base64');
    const v1Mac = createHmac('sha256', keyBuf).update(ckptRaw).digest('hex');
    writeFileSync(
      jsonl + '.checkpoint.hmac',
      JSON.stringify({ kid: 'default', mac: v1Mac }),
      'utf-8',
    );

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /v1|legacy|version|refus/i.test(e)),
    ).toBe(true);
  });

  it('refuses to seed when the jsonl tail is corrupted (keyless mode)', () => {
    delete process.env[ENV_KEY];

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    for (let i = 0; i < 3; i++) logOnce(writer, `e-${i}`);
    const jsonl = jsonlPath(workdir);

    // Append a half-written line - readJsonlTailSeq used to swallow this and
    // skip the replay-check entirely.
    writeFileSync(jsonl, readFileSync(jsonl, 'utf-8') + '{"seq":\n', 'utf-8');

    // Roll the checkpoint back to seq=0.
    const oldCkpt = JSON.stringify({ lastSeq: 0, lastHash: 'a'.repeat(64) });
    writeFileSync(jsonl + '.checkpoint', oldCkpt, 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /(corrupt|unparsable|tail|tamper|refus)/i.test(e)),
    ).toBe(true);
  });

  it('refuses to seed when jsonl is empty but checkpoint claims lastSeq>0', () => {
    delete process.env[ENV_KEY];

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    logOnce(writer, 'a');
    const jsonl = jsonlPath(workdir);

    // Truncate the jsonl to zero bytes; checkpoint still claims seq=0
    // exists. Then forge a checkpoint claiming lastSeq>0.
    writeFileSync(jsonl, '', 'utf-8');
    const forged = JSON.stringify({ lastSeq: 99, lastHash: 'b'.repeat(64) });
    writeFileSync(jsonl + '.checkpoint', forged, 'utf-8');

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);

    expect(
      errors.some((e) => /(empty|missing.*entries|state|refus)/i.test(e)),
    ).toBe(true);
  });

  it('refuses a forged lastSeq=0 checkpoint paired with an empty jsonl tail (keyless replay)', () => {
    delete process.env[ENV_KEY];

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    for (let i = 0; i < 5; i++) logOnce(writer, `e-${i}`);
    const jsonl = jsonlPath(workdir);

    // Attacker rolls everything back to a pristine "first boot" shape:
    //   - truncate jsonl
    //   - overwrite checkpoint with seq=0
    //   - delete the external watermark for this audit dir
    writeFileSync(jsonl, '', 'utf-8');
    const forged = JSON.stringify({ lastSeq: 0, lastHash: 'a'.repeat(64) });
    writeFileSync(jsonl + '.checkpoint', forged, 'utf-8');
    rmSync(getWatermarkPath(workdir), { force: true });

    const restart = new AuditLogger();
    restart.enablePersistence(workdir);
    logOnce(restart, 'after-replay');

    // If the seed was refused, the new entry must start a fresh chain at
    // seq=0 with an empty prevHash. If the bypass succeeded the logger
    // would have kept the forged seq=0+1=1 with prevHash='a'.repeat(64).
    const lines = readFileSync(jsonl, 'utf-8').trim().split('\n').filter((l) => l);
    const last = JSON.parse(lines[lines.length - 1]) as { seq: number; prevHash: string };
    expect(last.seq).toBe(0);
    expect(last.prevHash).toBe('');
  });

  it('leaves no .checkpoint.tmp.* files behind during normal persistence', () => {
    process.env[ENV_KEY] = makeKey();

    const writer = new AuditLogger();
    writer.enablePersistence(workdir);
    for (let i = 0; i < 5; i++) logOnce(writer, `e-${i}`);

    const stragglers = readdirSync(workdir).filter((f) => f.includes('.tmp.'));
    expect(stragglers).toEqual([]);
  });

  it('still seeds normally when the checkpoint pair matches the current jsonl tail', () => {
    process.env[ENV_KEY] = makeKey();

    const writer1 = new AuditLogger();
    writer1.enablePersistence(workdir);
    for (let i = 0; i < 3; i++) logOnce(writer1, `e-${i}`);

    const writer2 = new AuditLogger();
    writer2.enablePersistence(workdir);
    logOnce(writer2, 'after-restart');

    const jsonl = jsonlPath(workdir);
    const lines = readFileSync(jsonl, 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]) as { seq: number };
    // 3 entries before restart (seq 0..2) + 1 after restart -> last seq must be 3.
    expect(last.seq).toBe(3);
  });
});
