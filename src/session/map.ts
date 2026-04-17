import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { SessionMap, LayerName } from '../types.js';
import { PersistStore } from './persist.js';

interface EntryMeta {
  layer: LayerName;
  type: string;
  createdAt: number;
}

interface EncryptedValue {
  iv: Buffer;
  data: Buffer;
  tag: Buffer;
}

export interface BiMapOptions {
  persist?: boolean;
  persistPath?: string;
  /** Optional explicit key for AES-256-GCM (must be 32 bytes). Useful for
   *  deterministic tests and for reopening a persisted DB. When omitted a
   *  fresh random key is generated. */
  key?: Buffer;
}

const ALGO = 'aes-256-gcm';

export class BiMap implements SessionMap {
  private fwd = new Map<string, string>();
  private rev = new Map<string, EncryptedValue>();
  private meta = new Map<string, EntryMeta>();
  private key: Buffer;
  private store: PersistStore | null = null;
  // Snapshot of pseudonym -> decrypted original. Rebuilt lazily on first read
  // after a mutation. Avoids the O(n) AES-GCM decrypt loop that used to run
  // on every rehydrate() call (which touches entries() for each SSE chunk).
  // Tradeoff: duplicates session-map footprint in cleartext. See SECURITY.md.
  private decryptedCache: Map<string, string> | null = null;

  constructor(opts: BiMapOptions = {}) {
    this.key = opts.key ?? randomBytes(32);

    if (opts.persist) {
      const path = opts.persistPath ?? './ainonymous-session.db';
      this.store = new PersistStore(path);
      this.hydrateFromStore();
    }
  }

  set(original: string, pseudonym: string, layer: LayerName, type: string): void {
    const hash = this.hash(original);
    if (this.fwd.has(hash)) return;

    // Pseudonym collision: PseudoGen cycles (Greek/two-letter) mean two
    // separate originals can land on the same pseudonym after enough
    // entries. particularly across processes sharing a persisted DB.
    // Without a guard the second insert quietly overwrites the reverse map
    // and rehydration returns the wrong original for the winner pseudonym.
    if (this.rev.has(pseudonym)) {
      const existing = this.decrypt(this.rev.get(pseudonym)!);
      if (existing !== original) {
        throw new Error(
          `session-map pseudonym collision: "${pseudonym}" already maps to a different original. ` +
            `Restart the proxy or rotate the session key to reset the generator.`,
        );
      }
    }

    const createdAt = Date.now();
    this.fwd.set(hash, pseudonym);
    this.rev.set(pseudonym, this.encrypt(original));
    this.meta.set(hash, { layer, type, createdAt });
    this.decryptedCache = null;

    if (this.store) {
      this.store.insert(original, pseudonym, this.key, createdAt);
    }
  }

  getByOriginal(original: string): string | undefined {
    return this.fwd.get(this.hash(original));
  }

  getByPseudonym(pseudonym: string): string | undefined {
    if (this.decryptedCache) {
      return this.decryptedCache.get(pseudonym);
    }
    const encrypted = this.rev.get(pseudonym);
    if (!encrypted) return undefined;
    return this.decrypt(encrypted);
  }

  getMeta(original: string): EntryMeta | undefined {
    return this.meta.get(this.hash(original));
  }

  entries(): Iterable<[string, string]> {
    const snapshot = this.getDecryptedSnapshot();
    const result: [string, string][] = [];
    for (const [pseudonym, original] of snapshot) {
      result.push([original, pseudonym]);
    }
    return result;
  }

  get size(): number {
    return this.fwd.size;
  }

  /** Longest pseudonym currently stored. Used by the SSE stream rehydrator
   *  to size its per-content-block sliding buffer: any pseudonym split across
   *  deltas fits inside a window of this length. Returns 0 on an empty map. */
  getMaxPseudonymLength(): number {
    let max = 0;
    for (const pseudo of this.rev.keys()) {
      if (pseudo.length > max) max = pseudo.length;
    }
    return max;
  }

  clear(): void {
    this.fwd.clear();
    this.rev.clear();
    this.meta.clear();
    this.decryptedCache = null;
    this.key = randomBytes(32);
    if (this.store) {
      this.store.clear();
    }
  }

  /** Rotates the in-memory AES key and, if persistence is enabled, re-encrypts
   *  every persisted row. On failure the DB remains on the old key. */
  rotateKey(newKey: Buffer): void {
    if (newKey.length !== 32) {
      throw new Error('session map: rotate key must be 32 bytes');
    }
    const oldKey = this.key;

    if (this.store) {
      this.store.rotate(oldKey, newKey);
    }

    // Re-encrypt in-memory rev map with the new key too, else getByPseudonym breaks.
    const next = new Map<string, EncryptedValue>();
    for (const [pseudonym, enc] of this.rev) {
      const plain = this.decrypt(enc);
      next.set(pseudonym, encryptWith(plain, newKey));
    }
    this.rev = next;
    this.key = newKey;
    this.decryptedCache = null;
  }

  close(): void {
    if (this.store) {
      this.store.close();
      this.store = null;
    }
  }

  private hydrateFromStore(): void {
    if (!this.store) return;
    for (const row of this.store.loadAll(this.key)) {
      const h = this.hash(row.original);
      // Mirror set()'s collision guard: two writers with overlapping pseudo
      // counters against the same persisted DB could otherwise race and the
      // reverse map would point at whichever row loaded last.
      if (this.rev.has(row.pseudonym)) {
        const existingEnc = this.rev.get(row.pseudonym)!;
        const existing = this.decrypt(existingEnc);
        if (existing !== row.original) continue;
      }
      this.fwd.set(h, row.pseudonym);
      this.rev.set(row.pseudonym, this.encrypt(row.original));
      this.meta.set(h, { layer: 'identity', type: 'restored', createdAt: row.createdAt });
    }
  }

  private getDecryptedSnapshot(): Map<string, string> {
    if (this.decryptedCache) return this.decryptedCache;
    const snapshot = new Map<string, string>();
    for (const [pseudonym, encrypted] of this.rev) {
      snapshot.set(pseudonym, this.decrypt(encrypted));
    }
    this.decryptedCache = snapshot;
    return snapshot;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private encrypt(plaintext: string): EncryptedValue {
    return encryptWith(plaintext, this.key);
  }

  private decrypt(entry: EncryptedValue): string {
    const decipher = createDecipheriv(ALGO, this.key, entry.iv);
    decipher.setAuthTag(entry.tag);
    return decipher.update(entry.data) + decipher.final('utf8');
  }
}

function encryptWith(plaintext: string, key: Buffer): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, data, tag };
}
