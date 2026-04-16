import { createHash } from 'node:crypto';
import { writeFileSync, appendFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry, Replacement, LayerName } from '../types.js';

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

export class AuditLogger {
  private records: AuditEntry[] = [];
  private persistDir: string | null = null;
  private seq = 0;
  private lastHash = '';

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
    };
    const entry: AuditEntry = { ...base, prevHash: this.lastHash };
    this.lastHash = chainHash(this.lastHash, base);
    this.records.push(entry);
    this.persistEntry(entry);
  }

  logBatch(replacements: Replacement[]): void {
    for (const r of replacements) this.log(r);
  }

  entries(): AuditEntry[] {
    return [...this.records];
  }

  stats(): { secrets: number; identity: number; code: number; total: number } {
    let secrets = 0;
    let identity = 0;
    let code = 0;
    for (const entry of this.records) {
      if (entry.layer === 'secrets') secrets++;
      else if (entry.layer === 'identity') identity++;
      else if (entry.layer === 'code') code++;
    }
    return { secrets, identity, code, total: this.records.length };
  }

  clear(): void {
    this.records = [];
    this.seq = 0;
    this.lastHash = '';
  }

  export(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this.records, null, 2), 'utf-8');
  }

  enablePersistence(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.persistDir = dir;
  }

  query(opts: { from?: number; to?: number; layer?: LayerName; type?: string }): AuditEntry[] {
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
    const filepath = this.currentFile();
    appendFileSync(filepath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  private currentFile(): string {
    if (!this.persistDir) throw new Error('persistence not enabled');
    const base = `ainonymity-audit-${todayStamp()}`;
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
export function verifyAuditChain(lines: string[]): number | null {
  let prev = '';
  let expectedSeq = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: AuditEntry;
    try {
      entry = JSON.parse(line) as AuditEntry;
    } catch {
      return expectedSeq;
    }
    // session boundary: a fresh logger starts with seq=0 and empty prevHash
    if (entry.seq === 0 && entry.prevHash === '' && expectedSeq !== 0) {
      prev = '';
      expectedSeq = 0;
    }
    if (entry.seq !== expectedSeq) return expectedSeq;
    if (entry.prevHash !== prev) return entry.seq ?? expectedSeq;
    const { prevHash: _prev, ...base } = entry;
    prev = chainHash(prev, base);
    expectedSeq++;
  }
  return null;
}
