import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { BiMap } from '../../src/session/map.js';

function freshKey(): Buffer {
  return randomBytes(32);
}

describe('BiMap persistence', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ain-persist-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('does not create a DB file when persist is false (default)', () => {
    const dbPath = join(workDir, 'session.db');
    const map = new BiMap({ persist: false, persistPath: dbPath });
    map.set('artur@asom.de', 'user1@alpha.io', 'identity', 'email');
    expect(existsSync(dbPath)).toBe(false);
    map.close();
  });

  it('ignores persistPath when persist is false', () => {
    const dbPath = join(workDir, 'ignored.db');
    const map = new BiMap({ persist: false, persistPath: dbPath });
    map.set('a', 'b', 'identity', 'email');
    expect(readdirSync(workDir)).toHaveLength(0);
    map.close();
  });

  it('creates a DB file after first set() when persist is true', () => {
    const dbPath = join(workDir, 'session.db');
    const map = new BiMap({ persist: true, persistPath: dbPath, key: freshKey() });
    map.set('artur@asom.de', 'user1@alpha.io', 'identity', 'email');
    expect(existsSync(dbPath)).toBe(true);
    map.close();
  });

  it('normal lookups still work when persistence is on', () => {
    const dbPath = join(workDir, 'session.db');
    const map = new BiMap({ persist: true, persistPath: dbPath, key: freshKey() });
    map.set('artur@asom.de', 'user1@alpha.io', 'identity', 'email');
    expect(map.getByOriginal('artur@asom.de')).toBe('user1@alpha.io');
    expect(map.getByPseudonym('user1@alpha.io')).toBe('artur@asom.de');
    map.close();
  });

  it('restores entries from existing DB with same key', () => {
    const dbPath = join(workDir, 'session.db');
    const key = freshKey();

    const first = new BiMap({ persist: true, persistPath: dbPath, key });
    first.set('artur@asom.de', 'user1@alpha.io', 'identity', 'email');
    first.set('CustomerService', 'AlphaService', 'code', 'class-name');
    first.close();

    const second = new BiMap({ persist: true, persistPath: dbPath, key });
    expect(second.getByOriginal('artur@asom.de')).toBe('user1@alpha.io');
    expect(second.getByPseudonym('user1@alpha.io')).toBe('artur@asom.de');
    expect(second.getByOriginal('CustomerService')).toBe('AlphaService');
    expect(second.size).toBe(2);
    second.close();
  });

  it('discards unreadable rows when key mismatches', () => {
    const dbPath = join(workDir, 'session.db');

    const first = new BiMap({ persist: true, persistPath: dbPath, key: freshKey() });
    first.set('artur@asom.de', 'user1@alpha.io', 'identity', 'email');
    first.close();

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;

    try {
      const second = new BiMap({ persist: true, persistPath: dbPath, key: freshKey() });
      expect(second.size).toBe(0);
      expect(second.getByOriginal('artur@asom.de')).toBeUndefined();
      second.close();
    } finally {
      process.stderr.write = origWrite;
    }

    const joined = stderrChunks.join('');
    expect(joined).toMatch(/could not be decrypted/);
  });

  it('rotates key across all persisted rows', () => {
    const dbPath = join(workDir, 'session.db');
    const oldKey = freshKey();

    const map = new BiMap({ persist: true, persistPath: dbPath, key: oldKey });
    map.set('artur@asom.de', 'user1@alpha.io', 'identity', 'email');
    map.set('acme.internal', 'alpha-corp.internal', 'identity', 'domain');

    const newKey = freshKey();
    map.rotateKey(newKey);

    expect(map.getByOriginal('artur@asom.de')).toBe('user1@alpha.io');
    expect(map.getByPseudonym('alpha-corp.internal')).toBe('acme.internal');
    map.close();

    const reopenedWithNew = new BiMap({ persist: true, persistPath: dbPath, key: newKey });
    expect(reopenedWithNew.size).toBe(2);
    expect(reopenedWithNew.getByPseudonym('alpha-corp.internal')).toBe('acme.internal');
    reopenedWithNew.close();

    const reopenedWithOld = new BiMap({ persist: true, persistPath: dbPath, key: oldKey });
    expect(reopenedWithOld.size).toBe(0);
    reopenedWithOld.close();
  });

  it('throws a clear error when persistPath is not writable', () => {
    const impossiblePath = join(workDir, 'no-such-dir', 'nested', 'session.db');
    expect(
      () => new BiMap({ persist: true, persistPath: impossiblePath, key: freshKey() }),
    ).toThrow(/session map/i);
  });

  it('writes encrypted blobs, not cleartext, to the DB', () => {
    const dbPath = join(workDir, 'session.db');
    const original = 'artur.wolf@internal.asom.de';

    const map = new BiMap({ persist: true, persistPath: dbPath, key: freshKey() });
    map.set(original, 'user1@alpha.io', 'identity', 'email');
    map.close();

    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('SELECT * FROM bimap').all() as Array<{
      original_hash: string;
      pseudonym_hash: string;
      original_enc: Uint8Array;
      pseudonym_enc: Uint8Array;
      iv: Uint8Array;
      tag: Uint8Array;
      created_at: number;
    }>;
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.original_enc).toBeInstanceOf(Uint8Array);
    expect(row.pseudonym_enc).toBeInstanceOf(Uint8Array);
    expect(row.iv).toBeInstanceOf(Uint8Array);
    expect(row.tag).toBeInstanceOf(Uint8Array);
    expect(row.iv.length).toBe(12);
    // tag stores two 16-byte GCM tags concatenated
    expect(row.tag.length).toBe(32);
    const encText = Buffer.from(row.original_enc).toString('utf8');
    const pseuText = Buffer.from(row.pseudonym_enc).toString('utf8');
    expect(encText).not.toContain('artur');
    expect(encText).not.toContain('asom');
    expect(pseuText).not.toContain('alpha');
    expect(typeof row.created_at).toBe('number');
    expect(row.created_at).toBeGreaterThan(0);

    db.close();
  });

  it('writes two consecutive sets without losing rows', () => {
    const dbPath = join(workDir, 'session.db');
    const map = new BiMap({ persist: true, persistPath: dbPath, key: freshKey() });
    map.set('a@one.de', 'u1@alpha.io', 'identity', 'email');
    map.set('b@two.de', 'u2@alpha.io', 'identity', 'email');
    map.close();

    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS n FROM bimap').get() as { n: number };
    db.close();
    expect(row.n).toBe(2);
  });

  it('clear() wipes persisted rows too', () => {
    const dbPath = join(workDir, 'session.db');
    const map = new BiMap({ persist: true, persistPath: dbPath, key: freshKey() });
    map.set('a', 'b', 'identity', 'email');
    map.clear();
    map.close();

    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS n FROM bimap').get() as { n: number };
    db.close();
    expect(row.n).toBe(0);
  });

  it('stays backwards compatible: no-arg constructor works memory-only', () => {
    const map = new BiMap();
    map.set('a', 'b', 'identity', 'email');
    expect(map.getByOriginal('a')).toBe('b');
    expect(map.size).toBe(1);
    map.close();
  });
});
