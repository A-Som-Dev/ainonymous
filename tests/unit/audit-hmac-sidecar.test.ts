import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { AuditLogger } from '../../src/audit/logger.js';
import { verifyFile } from '../../src/audit/verify-scan.js';

const ENV_KEY = 'AINONYMOUS_AUDIT_HMAC_KEY';

function makeKey(): string {
  return randomBytes(32).toString('base64');
}

describe('audit hmac sidecar', () => {
  let workdir: string;
  let originalKey: string | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-hmac-'));
    originalKey = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalKey;
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  it('writes a .hmac sidecar next to the jsonl when key is set', () => {
    process.env[ENV_KEY] = makeKey();
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
    const files = readdirSync(workdir);
    expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true);
    expect(files.some((f) => f.endsWith('.jsonl.hmac'))).toBe(true);
  });

  it('skips sidecar writing when key env is absent', () => {
    delete process.env[ENV_KEY];
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
    const files = readdirSync(workdir);
    expect(files.some((f) => f.endsWith('.hmac'))).toBe(false);
  });

  it('verifyFile returns ok when sidecar macs match the log', () => {
    process.env[ENV_KEY] = makeKey();
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
    const jsonl = join(workdir, readdirSync(workdir).find((f) => f.endsWith('.jsonl'))!);
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('ok');
  });

  it('verifyFile flags tamper when an entry was modified after sidecar was written', () => {
    process.env[ENV_KEY] = makeKey();
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
    const jsonl = join(workdir, readdirSync(workdir).find((f) => f.endsWith('.jsonl'))!);
    const lines = readFileSync(jsonl, 'utf-8');
    writeFileSync(jsonl, lines.replace('person-name', 'person-foo'), 'utf-8');
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });

  it('verifyFile flags tamper when sidecar exists but env key is unset at verify-time', () => {
    process.env[ENV_KEY] = makeKey();
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
    const jsonl = join(workdir, readdirSync(workdir).find((f) => f.endsWith('.jsonl'))!);
    delete process.env[ENV_KEY];
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });

  it('verifyFile flags tamper when sidecar mixes kid-tagged and kid-less entries', () => {
    process.env[ENV_KEY] = makeKey();
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
    logger.log({
      original: 'b',
      pseudonym: 'Beta',
      layer: 'identity',
      type: 'person-name',
      offset: 0,
      length: 1,
    });
    const jsonl = join(workdir, readdirSync(workdir).find((f) => f.endsWith('.jsonl'))!);
    const hmacPath = jsonl + '.hmac';
    const orig = readFileSync(hmacPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    // Downgrade first line to the kid-less legacy format.
    const parsed = JSON.parse(orig[0]) as { seq: number; kid?: string; mac: string };
    const downgraded = JSON.stringify({ seq: parsed.seq, mac: parsed.mac });
    writeFileSync(hmacPath, downgraded + '\n' + orig.slice(1).join('\n') + '\n', 'utf-8');
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });

  it('verifyFile flags tamper when the sidecar is missing while key is set', () => {
    process.env[ENV_KEY] = makeKey();
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
    const jsonl = join(workdir, readdirSync(workdir).find((f) => f.endsWith('.jsonl'))!);
    rmSync(jsonl + '.hmac');
    expect(existsSync(jsonl + '.hmac')).toBe(false);
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });
});
