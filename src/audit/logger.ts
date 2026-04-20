import { createHash, randomBytes } from 'node:crypto';
import {
  writeFileSync,
  appendFileSync,
  mkdirSync,
  statSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry, Replacement, AuditLayer } from '../types.js';
import { isSentinel } from '../session/map.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function hashTruncated(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function chainHash(prev: string, entry: Omit<AuditEntry, 'prevHash'>): string {
  const serialized = JSON.stringify(entry);
  return createHash('sha256').update(prev).update(serialized).digest('hex');
}

export type AuditFailureMode = 'block' | 'permit';

export class AuditPersistError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuditPersistError';
  }
}

export class AuditLogger {
  private records: AuditEntry[] = [];
  private persistDir: string | null = null;
  private seq = 0;
  private lastHash = '';
  private failureMode: AuditFailureMode = 'permit';

  log(r: Replacement): void {
    // pseudonyms are intentionally NOT persisted - reidentification via session map
    // plus audit log would break pseudonymization under GDPR Art. 4(5). The dashboard
    // gets pseudonyms via broadcastEntry directly from the Replacement.
    const base: Omit<AuditEntry, 'prevHash'> = {
      timestamp: Date.now(),
      layer: r.layer,
      type: r.type,
      originalHash: hashTruncated(r.original),
      context: `${r.type}@${r.offset}:${r.length}`,
      seq: this.seq++,
      ...(isSentinel(r.pseudonym) ? { sentinel: true as const } : {}),
    };
    const entry: AuditEntry = { ...base, prevHash: this.lastHash };
    this.lastHash = chainHash(this.lastHash, base);
    this.records.push(entry);
    this.persistEntry(entry);
  }

  logBatch(replacements: Replacement[]): void {
    for (const r of replacements) this.log(r);
  }

  /** Record which pseudonyms the rehydrator actually swapped back into the
   *  response. `audit pending` diffs anonymize-originals against these to show
   *  session-map entries the LLM never referenced. */
  logRehydration(
    entries: Array<Pick<Replacement, 'original' | 'pseudonym' | 'layer' | 'type'>>,
  ): void {
    for (const e of entries) {
      const base: Omit<AuditEntry, 'prevHash'> = {
        timestamp: Date.now(),
        layer: 'rehydration',
        type: e.type,
        originalHash: hashTruncated(e.original),
        context: `rehydrated:${e.layer}/${e.type}`,
        seq: this.seq++,
      };
      const entry: AuditEntry = { ...base, prevHash: this.lastHash };
      this.lastHash = chainHash(this.lastHash, base);
      this.records.push(entry);
      this.persistEntry(entry);
    }
  }

  entries(): AuditEntry[] {
    return [...this.records];
  }

  stats(): {
    secrets: number;
    identity: number;
    code: number;
    rehydrated: number;
    total: number;
  } {
    let secrets = 0;
    let identity = 0;
    let code = 0;
    let rehydrated = 0;
    for (const entry of this.records) {
      if (entry.layer === 'secrets') secrets++;
      else if (entry.layer === 'identity') identity++;
      else if (entry.layer === 'code') code++;
      else if (entry.layer === 'rehydration') rehydrated++;
    }
    return { secrets, identity, code, rehydrated, total: this.records.length };
  }

  clear(): void {
    this.records = [];
    this.seq = 0;
    this.lastHash = '';
  }

  export(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this.records, null, 2), 'utf-8');
  }

  enablePersistence(dir: string, failureMode: AuditFailureMode = 'permit'): void {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const probe = join(dir, `.ainonymous-probe-${randomBytes(6).toString('hex')}`);
      writeFileSync(probe, '', 'utf-8');
      unlinkSync(probe);
    } catch (err) {
      const msg = `audit probe-write failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`;
      if (failureMode === 'block') {
        throw new AuditPersistError(msg, err);
      }
      console.error(`WARNING: ${msg} - proxy started under auditFailure=permit`);
    }
    this.persistDir = dir;
    this.failureMode = failureMode;
  }

  query(opts: { from?: number; to?: number; layer?: AuditLayer; type?: string }): AuditEntry[] {
    return this.records.filter((e) => {
      if (opts.from !== undefined && e.timestamp < opts.from) return false;
      if (opts.to !== undefined && e.timestamp > opts.to) return false;
      if (opts.layer !== undefined && e.layer !== opts.layer) return false;
      if (opts.type !== undefined && e.type !== opts.type) return false;
      return true;
    });
  }

  private persistEntry(entry: AuditEntry): void {
    if (!this.persistDir) return;
    try {
      const filepath = this.currentFile();
      appendFileSync(filepath, JSON.stringify(entry) + '\n', 'utf-8');
      const ckpt = filepath + '.checkpoint';
      writeFileSync(ckpt, JSON.stringify({ lastSeq: entry.seq, lastHash: this.lastHash }), 'utf-8');
    } catch (err) {
      if (this.failureMode === 'block') {
        throw new AuditPersistError(
          `audit persist failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
      console.error(
        `WARNING: audit persist failed (${err instanceof Error ? err.message : String(err)}) - request continuing under auditFailure=permit`,
      );
    }
  }

  private currentFile(): string {
    if (!this.persistDir) throw new Error('persistence not enabled');
    const base = `ainonymous-audit-${todayStamp()}`;
    let part = 0;
    while (true) {
      const suffix = part === 0 ? '' : `.part${part}`;
      const path = join(this.persistDir, `${base}${suffix}.jsonl`);
      if (!existsSync(path)) return path;
      const size = statSync(path).size;
      if (size < MAX_FILE_BYTES) return path;
      part++;
    }
  }
}

/**
 * Verify a JSONL audit file's hash chain. Returns the first bad sequence
 * number or null if the chain is intact. A session boundary (seq === 0 with
 * empty prevHash) after a prior session is treated as a valid restart, not
 * tampering - AuditLogger resets its state on clear() and on new-instance.
 */
export function verifyAuditChain(
  lines: string[],
  expected?: { lastSeq: number; lastHash: string } | 'required',
): number | null {
  let prev = '';
  let expectedSeq = 0;
  let actualLastSeq = -1;
  let actualLastHash = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: AuditEntry;
    try {
      entry = JSON.parse(line) as AuditEntry;
    } catch {
      return expectedSeq;
    }
    if (entry.seq === 0 && entry.prevHash === '' && expectedSeq !== 0) {
      prev = '';
      expectedSeq = 0;
    }
    if (entry.seq !== expectedSeq) return expectedSeq;
    if (entry.prevHash !== prev) return entry.seq ?? expectedSeq;
    const { prevHash: _prev, ...base } = entry;
    prev = chainHash(prev, base);
    actualLastSeq = entry.seq;
    actualLastHash = prev;
    expectedSeq++;
  }
  // Callers that ran the logger with persistence on MUST pass the sidecar
  // checkpoint. Without it, an attacker who can delete both the last N
  // JSONL lines AND the `.checkpoint` file ends up with an internally
  // consistent (but truncated) chain that would verify silently. Treat a
  // missing checkpoint as a tamper event under required-mode.
  if (expected === 'required') return actualLastSeq < 0 ? 0 : actualLastSeq + 1;
  if (expected && typeof expected === 'object') {
    if (actualLastSeq !== expected.lastSeq || actualLastHash !== expected.lastHash) {
      return actualLastSeq + 1;
    }
  }
  return null;
}
