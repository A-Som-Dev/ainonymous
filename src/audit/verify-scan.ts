import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry } from '../types.js';
import { verifyAuditChain } from './logger.js';

export interface VerifyResult {
  file: string;
  status: 'ok' | 'tamper' | 'missing-checkpoint';
  badSeq?: number;
  lastSeq?: number;
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
    return { file: path, status: 'tamper', badSeq: -1 };
  }

  let expected: { lastSeq: number; lastHash: string } | 'required' | undefined;
  if (existsSync(ckptPath)) {
    try {
      expected = JSON.parse(readFileSync(ckptPath, 'utf-8')) as {
        lastSeq: number;
        lastHash: string;
      };
    } catch {
      return { file: path, status: 'tamper', badSeq: -1 };
    }
  } else if (strict) {
    expected = 'required';
  }

  const bad = verifyAuditChain(lines, expected);
  if (bad !== null) {
    if (expected === 'required') {
      return { file: path, status: 'missing-checkpoint' };
    }
    return { file: path, status: 'tamper', badSeq: bad };
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
