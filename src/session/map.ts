import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { SessionMap, LayerName } from '../types.js';
import { PersistStore } from './persist.js';
import { stripFormatChars } from '../patterns/normalize.js';
import { foldConfusable } from '../patterns/confusables.js';

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
export const SENTINEL_PSEUDONYMS = ['***ANONYMIZED***', '***REDACTED***'] as const;
const SENTINELS = new Set<string>(SENTINEL_PSEUDONYMS);
const SENTINEL_SHAPE_RE = /^\*{2,}(redacted|anonymized)\*{2,}$/i;

export function isSentinel(pseudonym: string): boolean {
  return SENTINELS.has(pseudonym);
}

function isSentinelShaped(s: string): boolean {
  const stripped = stripFormatChars(s).replace(/\s+/g, '');
  const nfkc = stripped.normalize('NFKC');
  let folded = '';
  for (const ch of nfkc) {
    const cp = ch.codePointAt(0) ?? 0;
    folded += foldConfusable(cp) ?? ch;
  }
  return SENTINEL_SHAPE_RE.test(folded);
}

export class BiMap implements SessionMap {
  private fwd = new Map<string, string>();
  private rev = new Map<string, EncryptedValue>();
  private meta = new Map<string, EntryMeta>();
  private sentinelFanout = new Map<string, Set<string>>();
  private key: Buffer;
  private store: PersistStore | null = null;
  // Cleartext snapshot, rebuilt lazily after mutations (SECURITY.md tradeoff).
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
    if (isSentinelShaped(original)) {
      throw new Error(`sentinel-shaped original rejected: ${JSON.stringify(original)}`);
    }
    const hash = this.hash(original);
    if (this.fwd.has(hash)) return;

    const sentinel = isSentinel(pseudonym);
    if (sentinel) {
      let set = this.sentinelFanout.get(pseudonym);
      if (!set) {
        set = new Set<string>();
        this.sentinelFanout.set(pseudonym, set);
      }
      set.add(hash);
    }

    if (!sentinel && this.rev.has(pseudonym)) {
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
    if (!sentinel) {
      this.rev.set(pseudonym, this.encrypt(original));
    }
    this.meta.set(hash, { layer, type, createdAt });
    this.decryptedCache = null;

    if (this.store && !sentinel) {
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

  sentinelFanoutCount(pseudonym: string): number {
    return this.sentinelFanout.get(pseudonym)?.size ?? 0;
  }

  /** Reserves a counter range on the persist store (no-op without persist). */
  reserveCounterBlock(name: string, size: number): { start: number; end: number } | null {
    if (!this.store) return null;
    return this.store.reserveCounterBlock(name, size);
  }

  /** Batch counterpart: reserves every named counter in a single transaction. */
  reserveCounterBlocks(
    names: readonly string[],
    size: number,
  ): Map<string, { start: number; end: number }> | null {
    if (!this.store) return null;
    return this.store.reserveCounterBlocks(names, size);
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
    this.sentinelFanout.clear();
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
