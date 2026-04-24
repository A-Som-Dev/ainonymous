import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { log } from '../logger.js';

const requireCjs = createRequire(import.meta.url);

const ALGO = 'aes-256-gcm';

export interface PersistedRow {
  original: string;
  pseudonym: string;
  createdAt: number;
}

interface RawRow {
  original_hash: string;
  pseudonym_hash: string;
  original_enc: Uint8Array;
  pseudonym_enc: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
  created_at: number;
}

// Minimal shape we rely on - loaded dynamically so older Node versions can
// still import this file without blowing up (node:sqlite is stable from 22.5).
interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDb;
}

let sqliteModule: SqliteModule | null = null;

function loadSqlite(): SqliteModule {
  if (sqliteModule) return sqliteModule;

  const [majorStr, minorStr] = process.versions.node.split('.');
  const major = Number(majorStr);
  const minor = Number(minorStr);
  if (major < 22 || (major === 22 && minor < 5)) {
    throw new Error(
      `session map: persistence requires Node.js >= 22.5.0, got ${process.versions.node}. ` +
        `Set session.persist to false or upgrade Node.`,
    );
  }

  try {
    sqliteModule = requireCjs('node:sqlite') as SqliteModule;
  } catch (err) {
    throw new Error(
      `session map: node:sqlite is not available on this runtime (${(err as Error).message}). ` +
        `Set session.persist to false or upgrade to Node.js 22.5+.`,
    );
  }
  return sqliteModule;
}

/** SQLite-backed storage for the BiMap. Rows are encrypted with the caller's
 *  AES-256-GCM key; the DB never sees plaintext. The class is deliberately
 *  unaware of the in-memory map structure - it just persists and reads rows.
 *
 *  Storage layout per row:
 *  - original_hash / pseudonym_hash: SHA-256 for lookup, not salted
 *  - original_enc: AES-GCM(original)          iv = `iv`,   tag = tag[0..15]
 *  - pseudonym_enc: AES-GCM(pseudonym)        iv = `iv2`,  tag = tag[16..31]
 *  where iv2 is derived from iv by XOR with 0x5a per byte. Fresh random iv
 *  per row means no pair reuse under the same key. */
export class PersistStore {
  private db: SqliteDb;
  private path: string;
  private insertStmt: SqliteStatement;
  private deleteStmt: SqliteStatement;
  private selectAllStmt: SqliteStatement;
  private selectRawStmt: SqliteStatement;
  private updateStmt: SqliteStatement;
  private beginStmt: SqliteStatement;
  private commitStmt: SqliteStatement;
  private rollbackStmt: SqliteStatement;
  private counterSelectStmt: SqliteStatement;
  private counterUpsertStmt: SqliteStatement;

  constructor(path: string) {
    this.path = path;
    this.db = openDb(path);

    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bimap (
        original_hash TEXT PRIMARY KEY,
        pseudonym_hash TEXT NOT NULL,
        original_enc BLOB NOT NULL,
        pseudonym_enc BLOB NOT NULL,
        iv BLOB NOT NULL,
        tag BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pseudonym_hash ON bimap(pseudonym_hash);
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.insertStmt = this.db.prepare(
      `INSERT OR REPLACE INTO bimap
       (original_hash, pseudonym_hash, original_enc, pseudonym_enc, iv, tag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteStmt = this.db.prepare('DELETE FROM bimap');
    this.selectAllStmt = this.db.prepare('SELECT * FROM bimap');
    this.selectRawStmt = this.db.prepare(
      'SELECT original_hash, original_enc, pseudonym_enc, iv, tag FROM bimap',
    );
    this.updateStmt = this.db.prepare(
      'UPDATE bimap SET original_enc = ?, pseudonym_enc = ?, iv = ?, tag = ? WHERE original_hash = ?',
    );
    this.beginStmt = this.db.prepare('BEGIN IMMEDIATE');
    this.commitStmt = this.db.prepare('COMMIT');
    this.rollbackStmt = this.db.prepare('ROLLBACK');
    this.counterSelectStmt = this.db.prepare('SELECT value FROM counters WHERE name = ?');
    this.counterUpsertStmt = this.db.prepare(
      `INSERT INTO counters (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
  }

  /** Batch variant: reserve one range per name in a single BEGIN IMMEDIATE
   *  transaction. Saves roughly one fsync per extra name on Windows and
   *  amortises the lock cost over the whole counter set. */
  reserveCounterBlocks(
    names: readonly string[],
    size: number,
  ): Map<string, { start: number; end: number }> {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`reserveCounterBlocks: size must be a positive integer, got ${size}`);
    }
    const out = new Map<string, { start: number; end: number }>();
    this.beginStmt.run();
    try {
      const now = Date.now();
      for (const name of names) {
        const row = this.counterSelectStmt.get(name) as { value: number | bigint } | undefined;
        const current = row ? Number(row.value) : 0;
        const end = current + size;
        if (!Number.isSafeInteger(end)) {
          throw new Error(
            `reserveCounterBlocks: counter "${name}" would overflow Number.MAX_SAFE_INTEGER ` +
              `(current=${current}, requested=${size}). Rotate the session DB or reset the counter.`,
          );
        }
        this.counterUpsertStmt.run(name, end, now);
        out.set(name, { start: current + 1, end });
      }
      this.commitStmt.run();
      return out;
    } catch (err) {
      try {
        this.rollbackStmt.run();
      } catch (rollbackErr) {
        log.error('reserveCounterBlocks rollback failed', {
          reason: (rollbackErr as Error).message,
        });
      }
      throw err;
    }
  }

  /** Atomically bumps the named counter by `size` and returns the reserved
   *  range [start, end]. Two processes sharing the same DB file always get
   *  disjoint blocks because the BEGIN IMMEDIATE takes a write lock and the
   *  upsert runs inside it. Counter names are free-form ASCII. */
  reserveCounterBlock(name: string, size: number): { start: number; end: number } {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`reserveCounterBlock: size must be a positive integer, got ${size}`);
    }
    this.beginStmt.run();
    try {
      const row = this.counterSelectStmt.get(name) as { value: number | bigint } | undefined;
      const current = row ? Number(row.value) : 0;
      const end = current + size;
      if (!Number.isSafeInteger(end)) {
        throw new Error(
          `reserveCounterBlock: counter "${name}" would overflow Number.MAX_SAFE_INTEGER ` +
            `(current=${current}, requested=${size}). Rotate the session DB or reset the counter.`,
        );
      }
      const start = current + 1;
      this.counterUpsertStmt.run(name, end, Date.now());
      this.commitStmt.run();
      return { start, end };
    } catch (err) {
      try {
        this.rollbackStmt.run();
      } catch (rollbackErr) {
        log.error('reserveCounterBlock rollback failed', {
          name,
          reason: (rollbackErr as Error).message,
        });
      }
      throw err;
    }
  }

  insert(original: string, pseudonym: string, key: Buffer, createdAt: number): void {
    const iv = randomBytes(12);
    const { enc: originalEnc, tag: originalTag } = encryptOne(original, key, iv);
    const iv2 = deriveIv(iv);
    const { enc: pseudoEnc, tag: pseudoTag } = encryptOne(pseudonym, key, iv2);

    this.insertStmt.run(
      hash(original),
      hash(pseudonym),
      toU8(originalEnc),
      toU8(pseudoEnc),
      toU8(iv),
      toU8(Buffer.concat([originalTag, pseudoTag])),
      createdAt,
    );
  }

  /** Returns all decryptable rows. Rows that fail to decrypt (wrong key,
   *  corruption) are silently dropped with a single aggregated warning. */
  loadAll(key: Buffer): PersistedRow[] {
    const rows = this.selectAllStmt.all() as RawRow[];
    const out: PersistedRow[] = [];
    let failed = 0;
    for (const row of rows) {
      try {
        const iv = asBuffer(row.iv);
        const tag = asBuffer(row.tag);
        const original = decryptOne(asBuffer(row.original_enc), iv, tag.subarray(0, 16), key);
        const pseudonym = decryptOne(
          asBuffer(row.pseudonym_enc),
          deriveIv(iv),
          tag.subarray(16, 32),
          key,
        );
        out.push({ original, pseudonym, createdAt: row.created_at });
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      log.warn(
        'session map: persisted rows could not be decrypted (key mismatch or corruption), discarded',
        { failed, total: rows.length, db: this.path },
      );
    }
    return out;
  }

  /** Re-encrypts every row with a new key inside a single transaction. If any
   *  row fails to decrypt with the old key, the rotation rolls back and the
   *  DB stays on the old key. */
  rotate(oldKey: Buffer, newKey: Buffer): void {
    const rows = this.selectRawStmt.all() as Array<{
      original_hash: string;
      original_enc: Uint8Array;
      pseudonym_enc: Uint8Array;
      iv: Uint8Array;
      tag: Uint8Array;
    }>;

    type Reenc = {
      hash: string;
      originalEnc: Buffer;
      pseudoEnc: Buffer;
      iv: Buffer;
      tag: Buffer;
    };
    const rewrites: Reenc[] = [];

    // Do the crypto work outside the transaction - if decrypt fails we don't
    // even open a write transaction.
    for (const row of rows) {
      const iv0 = asBuffer(row.iv);
      const tag0 = asBuffer(row.tag);
      const original = decryptOne(asBuffer(row.original_enc), iv0, tag0.subarray(0, 16), oldKey);
      const pseudonym = decryptOne(
        asBuffer(row.pseudonym_enc),
        deriveIv(iv0),
        tag0.subarray(16, 32),
        oldKey,
      );

      const iv = randomBytes(12);
      const { enc: originalEnc, tag: originalTag } = encryptOne(original, newKey, iv);
      const iv2 = deriveIv(iv);
      const { enc: pseudoEnc, tag: pseudoTag } = encryptOne(pseudonym, newKey, iv2);

      rewrites.push({
        hash: row.original_hash,
        originalEnc,
        pseudoEnc,
        iv,
        tag: Buffer.concat([originalTag, pseudoTag]),
      });
    }

    this.beginStmt.run();
    try {
      for (const r of rewrites) {
        this.updateStmt.run(
          toU8(r.originalEnc),
          toU8(r.pseudoEnc),
          toU8(r.iv),
          toU8(r.tag),
          r.hash,
        );
      }
      this.commitStmt.run();
    } catch (err) {
      try {
        this.rollbackStmt.run();
      } catch {
        // Nothing more we can do - surface the original error.
      }
      throw err;
    }
  }

  clear(): void {
    this.deleteStmt.run();
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed or never opened cleanly - nothing to do.
    }
  }
}

function openDb(path: string): SqliteDb {
  const { DatabaseSync } = loadSqlite();
  try {
    return new DatabaseSync(path);
  } catch (err) {
    const hint = dirname(path);
    throw new Error(
      `session map: cannot open persistence DB at "${path}" (parent: "${hint}"): ${(err as Error).message}`,
    );
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encryptOne(plaintext: string, key: Buffer, iv: Buffer): { enc: Buffer; tag: Buffer } {
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc, tag };
}

function decryptOne(data: Buffer, iv: Buffer, tag: Buffer, key: Buffer): string {
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

function deriveIv(base: Buffer): Buffer {
  const out = Buffer.alloc(12);
  for (let i = 0; i < 12; i++) {
    out[i] = base[i] ^ 0x5a;
  }
  return out;
}

function toU8(buf: Buffer): Uint8Array {
  // node:sqlite binds Buffers fine on insert (Buffer extends Uint8Array) but
  // being explicit keeps type boundaries clean.
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function asBuffer(u8: Uint8Array): Buffer {
  return Buffer.isBuffer(u8) ? u8 : Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}
