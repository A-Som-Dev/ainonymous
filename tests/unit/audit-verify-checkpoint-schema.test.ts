import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLogger } from '../../src/audit/logger.js';
import { verifyFile } from '../../src/audit/verify-scan.js';

describe('audit verify checkpoint schema', () => {
  let workdir: string;
  let jsonl: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-ckpt-'));
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
    const files = readdirSync(workdir).filter((f) => f.endsWith('.jsonl'));
    jsonl = join(workdir, files[0]);
  });

  afterEach(() => {
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  it('rejects a checkpoint that is missing required fields', () => {
    writeFileSync(jsonl + '.checkpoint', '{"lastSeq": 1}', 'utf-8');
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });

  it('rejects a checkpoint with a non-hex lastHash', () => {
    writeFileSync(jsonl + '.checkpoint', '{"lastSeq": 1, "lastHash": "not-a-hex-string"}', 'utf-8');
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });

  it('rejects a checkpoint with a negative lastSeq', () => {
    writeFileSync(
      jsonl + '.checkpoint',
      '{"lastSeq": -1, "lastHash": "' + 'a'.repeat(64) + '"}',
      'utf-8',
    );
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });

  it('rejects a checkpoint array (not an object)', () => {
    writeFileSync(jsonl + '.checkpoint', '[1, 2, 3]', 'utf-8');
    const result = verifyFile(jsonl, false);
    expect(result.status).toBe('tamper');
  });
});
