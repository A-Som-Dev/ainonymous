import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { AuditLogger, resolveAuditHmacKeyring, DEFAULT_HMAC_KID } from '../../src/audit/logger.js';
import { verifyFile } from '../../src/audit/verify-scan.js';

const ENV_KEY = 'AINONYMOUS_AUDIT_HMAC_KEY';
const ENV_ACTIVE_KID = 'AINONYMOUS_AUDIT_HMAC_ACTIVE_KID';
const ENV_KID_PREFIX = 'AINONYMOUS_AUDIT_HMAC_KEY_';

function makeKey(): string {
  return randomBytes(32).toString('base64');
}

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith(ENV_KID_PREFIX) || k === ENV_KEY || k === ENV_ACTIVE_KID) {
      snap[k] = process.env[k];
    }
  }
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith(ENV_KID_PREFIX) || k === ENV_KEY || k === ENV_ACTIVE_KID) {
      delete process.env[k];
    }
  }
  for (const [k, v] of Object.entries(snap)) {
    if (v !== undefined) process.env[k] = v;
  }
}

describe('audit hmac keyring', () => {
  let workdir: string;
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-hmac-kr-'));
    envSnap = snapshotEnv();
    for (const k of Object.keys(envSnap)) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(envSnap);
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  it('resolveAuditHmacKeyring returns the legacy key as "default" kid', () => {
    process.env[ENV_KEY] = makeKey();
    const ring = resolveAuditHmacKeyring();
    expect(ring).not.toBeNull();
    expect(ring!.get(DEFAULT_HMAC_KID)).toBeInstanceOf(Buffer);
    expect(ring!.size).toBe(1);
  });

  it('throws when the legacy env clashes with AINONYMOUS_AUDIT_HMAC_KEY_DEFAULT', () => {
    process.env[ENV_KEY] = makeKey();
    process.env[`${ENV_KID_PREFIX}DEFAULT`] = makeKey();
    expect(() => resolveAuditHmacKeyring()).toThrow(/conflicting keys/);
  });

  it('rejects kids that start with a non-alphanumeric character', () => {
    process.env[`${ENV_KID_PREFIX}_HIDDEN`] = makeKey();
    process.env[`${ENV_KID_PREFIX}.DOT`] = makeKey();
    const ring = resolveAuditHmacKeyring();
    expect(ring).toBeNull();
  });

  it('resolveAuditHmacKeyring picks up AINONYMOUS_AUDIT_HMAC_KEY_<KID>', () => {
    process.env[`${ENV_KID_PREFIX}V1`] = makeKey();
    process.env[`${ENV_KID_PREFIX}V2`] = makeKey();
    const ring = resolveAuditHmacKeyring();
    expect(ring).not.toBeNull();
    expect(ring!.size).toBe(2);
    expect(ring!.has('v1')).toBe(true);
    expect(ring!.has('v2')).toBe(true);
  });

  it('writes sidecar entries tagged with the active kid when using keyring', () => {
    process.env[`${ENV_KID_PREFIX}V2`] = makeKey();
    process.env[ENV_ACTIVE_KID] = 'v2';
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
    const hmacFile = readdirSync(workdir).find((f) => f.endsWith('.hmac'))!;
    const firstLine = readFileSync(join(workdir, hmacFile), 'utf-8').trim().split('\n')[0];
    const parsed = JSON.parse(firstLine) as { seq: number; kid: string; mac: string };
    expect(parsed.kid).toBe('v2');
  });

  it('verifyFile accepts a file signed with an older kid when that key is still in the keyring', () => {
    process.env[`${ENV_KID_PREFIX}V1`] = makeKey();
    process.env[ENV_ACTIVE_KID] = 'v1';
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

    // Operator rotates: v2 becomes active but v1 stays available.
    process.env[`${ENV_KID_PREFIX}V2`] = makeKey();
    process.env[ENV_ACTIVE_KID] = 'v2';

    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('ok');
  });

  it('verifyFile rejects a kid that is no longer in the keyring (revoked)', () => {
    process.env[`${ENV_KID_PREFIX}V1`] = makeKey();
    process.env[ENV_ACTIVE_KID] = 'v1';
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

    // Drop v1 entirely, bring up v2 only.
    delete process.env[`${ENV_KID_PREFIX}V1`];
    process.env[`${ENV_KID_PREFIX}V2`] = makeKey();
    process.env[ENV_ACTIVE_KID] = 'v2';

    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });

  it('verifyFile still rejects sidecar entries whose kid mixes with others within one file', () => {
    process.env[`${ENV_KID_PREFIX}V1`] = makeKey();
    process.env[`${ENV_KID_PREFIX}V2`] = makeKey();
    process.env[ENV_ACTIVE_KID] = 'v1';
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
    // Splice a second entry tagged with a different (also valid) kid.
    const parsed = JSON.parse(orig[1]) as { seq: number; kid?: string; mac: string };
    const swapped = JSON.stringify({ seq: parsed.seq, kid: 'v2', mac: parsed.mac });
    writeFileSync(hmacPath, orig[0] + '\n' + swapped + '\n', 'utf-8');
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });
});
