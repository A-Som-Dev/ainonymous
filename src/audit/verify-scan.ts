import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { AuditEntry } from '../types.js';
import { verifyAuditChain, resolveAuditHmacKeyring, hmacLine, DEFAULT_HMAC_KID } from './logger.js';

export type VerifyReason =
  | 'read-error'
  | 'checkpoint-parse'
  | 'chain-break'
  | 'sidecar-missing'
  | 'sidecar-without-key'
  | 'sidecar-parse'
  | 'sidecar-kid-mismatch'
  | 'sidecar-kid-revoked'
  | 'sidecar-mac-mismatch'
  | 'missing-seq';

export interface VerifyResult {
  file: string;
  status: 'ok' | 'tamper' | 'missing-checkpoint';
  badSeq?: number;
  lastSeq?: number;
  reason?: VerifyReason;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function parseCheckpoint(raw: string): { lastSeq: number; lastHash: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const lastSeq = obj.lastSeq;
  const lastHash = obj.lastHash;
  if (typeof lastSeq !== 'number' || !Number.isInteger(lastSeq) || lastSeq < 0) return null;
  if (typeof lastHash !== 'string' || !HEX64_RE.test(lastHash)) return null;
  return { lastSeq, lastHash };
}

export function findLogFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith('ainonymous-audit-') && f.endsWith('.jsonl'))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function verifyFile(path: string, strict: boolean): VerifyResult {
  const ckptPath = path + '.checkpoint';
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf-8').split('\n');
  } catch {
    return { file: path, status: 'tamper', badSeq: -1, reason: 'read-error' };
  }

  let expected: { lastSeq: number; lastHash: string } | 'required' | undefined;
  if (existsSync(ckptPath)) {
    const parsed = parseCheckpoint(readFileSync(ckptPath, 'utf-8'));
    if (parsed === null) {
      return { file: path, status: 'tamper', badSeq: -1, reason: 'checkpoint-parse' };
    }
    expected = parsed;
  } else if (strict) {
    expected = 'required';
  }

  const bad = verifyAuditChain(lines, expected);
  if (bad !== null) {
    if (expected === 'required') {
      return { file: path, status: 'missing-checkpoint' };
    }
    return { file: path, status: 'tamper', badSeq: bad, reason: 'chain-break' };
  }

  const keyring = resolveAuditHmacKeyring();
  const hmacPath = path + '.hmac';
  if (keyring === null && existsSync(hmacPath)) {
    return { file: path, status: 'tamper', badSeq: -1, reason: 'sidecar-without-key' };
  }
  if (keyring !== null) {
    if (!existsSync(hmacPath)) {
      return { file: path, status: 'tamper', badSeq: -1, reason: 'sidecar-missing' };
    }
    const sideLines = readFileSync(hmacPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    const macBySeq = new Map<number, { mac: string; kid: string }>();
    // Downgrade guard: a sidecar must not mix kid-tagged and kid-less entries
    // or span multiple kids within one log file.
    let kidLabel: string | undefined;
    for (const raw of sideLines) {
      try {
        const parsed = JSON.parse(raw) as { seq: unknown; mac: unknown; kid?: unknown };
        if (typeof parsed.seq !== 'number' || typeof parsed.mac !== 'string') {
          return { file: path, status: 'tamper', badSeq: -1, reason: 'sidecar-parse' };
        }
        const hasKid = parsed.kid !== undefined;
        if (hasKid && (typeof parsed.kid !== 'string' || parsed.kid === '')) {
          return {
            file: path,
            status: 'tamper',
            badSeq: parsed.seq,
            reason: 'sidecar-kid-mismatch',
          };
        }
        const kid = hasKid ? (parsed.kid as string) : DEFAULT_HMAC_KID;
        const label = hasKid ? `k:${kid}` : '-';
        if (kidLabel === undefined) kidLabel = label;
        else if (kidLabel !== label) {
          return {
            file: path,
            status: 'tamper',
            badSeq: parsed.seq,
            reason: 'sidecar-kid-mismatch',
          };
        }
        if (!keyring.has(kid)) {
          return {
            file: path,
            status: 'tamper',
            badSeq: parsed.seq,
            reason: 'sidecar-kid-revoked',
          };
        }
        macBySeq.set(parsed.seq, { mac: parsed.mac, kid });
      } catch {
        return { file: path, status: 'tamper', badSeq: -1, reason: 'sidecar-parse' };
      }
    }
    for (const raw of lines) {
      if (!raw.trim()) continue;
      let entry: AuditEntry;
      try {
        entry = JSON.parse(raw) as AuditEntry;
      } catch {
        return { file: path, status: 'tamper', badSeq: -1, reason: 'sidecar-parse' };
      }
      if (entry.seq === undefined) {
        return { file: path, status: 'tamper', badSeq: -1, reason: 'missing-seq' };
      }
      const expected = macBySeq.get(entry.seq);
      if (expected === undefined) {
        return {
          file: path,
          status: 'tamper',
          badSeq: entry.seq,
          reason: 'sidecar-mac-mismatch',
        };
      }
      const key = keyring.get(expected.kid);
      if (key === undefined) {
        return {
          file: path,
          status: 'tamper',
          badSeq: entry.seq,
          reason: 'sidecar-kid-revoked',
        };
      }
      const actualMac = hmacLine(key, raw);
      if (!constantTimeHexEqual(actualMac, expected.mac)) {
        return {
          file: path,
          status: 'tamper',
          badSeq: entry.seq,
          reason: 'sidecar-mac-mismatch',
        };
      }
    }
  }
  const lastEntry = lines
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as AuditEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is AuditEntry => e !== null)
    .at(-1);
  return { file: path, status: 'ok', lastSeq: lastEntry?.seq };
}

export function scanAuditDir(dir: string): VerifyResult[] {
  return findLogFiles(dir).map((f) => verifyFile(f, false));
}

const HMAC_REASONS: ReadonlySet<VerifyReason> = new Set<VerifyReason>([
  'sidecar-missing',
  'sidecar-without-key',
  'sidecar-parse',
  'sidecar-kid-mismatch',
  'sidecar-kid-revoked',
  'sidecar-mac-mismatch',
]);

export function isHmacFailure(r: VerifyResult): boolean {
  return r.reason !== undefined && HMAC_REASONS.has(r.reason);
}
