import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLogger, verifyAuditChain } from '../../src/audit/logger.js';
import type { Replacement } from '../../src/types.js';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  it('logs replacements', () => {
    const r: Replacement = {
      original: 'test@asom.de',
      pseudonym: 'user1@alpha.de',
      layer: 'identity',
      type: 'email',
      offset: 0,
      length: 12,
    };
    logger.log(r);
    expect(logger.entries()).toHaveLength(1);
  });

  it('hashes originals in entries', () => {
    const r: Replacement = {
      original: 'secret-stuff',
      pseudonym: 'anon',
      layer: 'identity',
      type: 'company',
      offset: 0,
      length: 12,
    };
    logger.log(r);
    const entry = logger.entries()[0];
    expect(entry.originalHash).not.toBe('secret-stuff');
    expect(entry.originalHash).toHaveLength(32);
  });

  it('tracks stats per layer', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'key',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'email',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'c',
      pseudonym: 'z',
      layer: 'identity',
      type: 'ip',
      offset: 0,
      length: 1,
    });
    const stats = logger.stats();
    expect(stats.secrets).toBe(1);
    expect(stats.identity).toBe(2);
    expect(stats.code).toBe(0);
    expect(stats.total).toBe(3);
  });

  it('clears log', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'key',
      offset: 0,
      length: 1,
    });
    logger.clear();
    expect(logger.entries()).toHaveLength(0);
    expect(logger.stats().total).toBe(0);
  });
});

describe('AuditLogger export', () => {
  let logger: AuditLogger;
  let tmpDir: string;

  beforeEach(() => {
    logger = new AuditLogger();
    tmpDir = mkdtempSync(join(tmpdir(), 'ainonymous-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON to file', () => {
    logger.log({
      original: 'pw123',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'password',
      offset: 0,
      length: 5,
    });
    logger.log({
      original: 'bob@co.de',
      pseudonym: 'y@z.de',
      layer: 'identity',
      type: 'email',
      offset: 10,
      length: 9,
    });

    const outPath = join(tmpDir, 'export.json');
    logger.export(outPath);

    const content = readFileSync(outPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].layer).toBe('secrets');
    expect(parsed[1].type).toBe('email');
  });

  it('does not include original values in export', () => {
    logger.log({
      original: 'my-secret-key',
      pseudonym: 'redacted',
      layer: 'secrets',
      type: 'api_key',
      offset: 0,
      length: 13,
    });

    const outPath = join(tmpDir, 'export.json');
    logger.export(outPath);

    const content = readFileSync(outPath, 'utf-8');
    expect(content).not.toContain('my-secret-key');
  });
});

describe('AuditLogger persistence', () => {
  let logger: AuditLogger;
  let tmpDir: string;

  beforeEach(() => {
    logger = new AuditLogger();
    tmpDir = mkdtempSync(join(tmpdir(), 'ainonymous-persist-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates JSONL file on first log after enablePersistence', () => {
    logger.enablePersistence(tmpDir);
    logger.log({
      original: 'test',
      pseudonym: 'anon',
      layer: 'identity',
      type: 'name',
      offset: 0,
      length: 4,
    });

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const expectedFile = join(tmpDir, `ainonymous-audit-${stamp}.jsonl`);

    expect(existsSync(expectedFile)).toBe(true);
  });

  it('writes one JSON object per line', () => {
    logger.enablePersistence(tmpDir);
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'key',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'email',
      offset: 5,
      length: 1,
    });
    logger.log({
      original: 'c',
      pseudonym: 'z',
      layer: 'code',
      type: 'ident',
      offset: 10,
      length: 1,
    });

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const filePath = join(tmpDir, `ainonymous-audit-${stamp}.jsonl`);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj).toHaveProperty('timestamp');
      expect(obj).toHaveProperty('layer');
      expect(obj).toHaveProperty('type');
      expect(obj).toHaveProperty('originalHash');
    }
  });

  it('creates directory recursively if needed', () => {
    const nested = join(tmpDir, 'deep', 'nested', 'dir');
    logger.enablePersistence(nested);
    logger.log({
      original: 'x',
      pseudonym: 'y',
      layer: 'secrets',
      type: 'key',
      offset: 0,
      length: 1,
    });

    expect(existsSync(nested)).toBe(true);
  });
});

describe('AuditLogger query', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'key',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'email',
      offset: 5,
      length: 1,
    });
    logger.log({
      original: 'c',
      pseudonym: 'z',
      layer: 'identity',
      type: 'domain',
      offset: 10,
      length: 1,
    });
    logger.log({
      original: 'd',
      pseudonym: 'w',
      layer: 'code',
      type: 'identifier',
      offset: 15,
      length: 1,
    });
  });

  it('filters by layer', () => {
    const result = logger.query({ layer: 'identity' });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.layer === 'identity')).toBe(true);
  });

  it('filters by type', () => {
    const result = logger.query({ type: 'email' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('email');
  });

  it('filters by date range', () => {
    const entries = logger.entries();
    const midTs = entries[1].timestamp;

    const before = logger.query({ to: midTs });
    expect(before.length).toBeGreaterThanOrEqual(1);
    expect(before.every((e) => e.timestamp <= midTs)).toBe(true);

    const after = logger.query({ from: midTs });
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(after.every((e) => e.timestamp >= midTs)).toBe(true);
  });

  it('combines multiple filters', () => {
    const result = logger.query({ layer: 'identity', type: 'domain' });
    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe('identity');
    expect(result[0].type).toBe('domain');
  });

  it('returns all entries with empty filter', () => {
    const result = logger.query({});
    expect(result).toHaveLength(4);
  });
});

describe('AuditLogger rehydration tracking', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  it('records rehydration entries with layer rehydration', () => {
    logger.logRehydration([
      { original: 'acme.de', pseudonym: 'alpha.de', layer: 'identity', type: 'domain' },
    ]);
    const entries = logger.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].layer).toBe('rehydration');
    expect(entries[0].type).toBe('domain');
    expect(entries[0].context).toContain('rehydrated:');
  });

  it('hashes originals on rehydration entries', () => {
    logger.logRehydration([
      { original: 'acme.de', pseudonym: 'alpha.de', layer: 'identity', type: 'domain' },
    ]);
    const entry = logger.entries()[0];
    expect(entry.originalHash).not.toContain('acme');
    expect(entry.originalHash).toHaveLength(32);
  });

  it('counts rehydrated in stats separately from code/identity/secrets', () => {
    logger.log({
      original: 'foo',
      pseudonym: 'Alpha',
      layer: 'code',
      type: 'identifier',
      offset: 0,
      length: 3,
    });
    logger.logRehydration([
      { original: 'foo', pseudonym: 'Alpha', layer: 'code', type: 'identifier' },
    ]);
    const s = logger.stats();
    expect(s.code).toBe(1);
    expect(s.rehydrated).toBe(1);
    expect(s.total).toBe(2);
  });

  it('continues the hash chain across rehydration entries', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'code',
      type: 'identifier',
      offset: 0,
      length: 1,
    });
    logger.logRehydration([{ original: 'a', pseudonym: 'x', layer: 'code', type: 'identifier' }]);
    const entries = logger.entries();
    expect(entries[0].seq).toBe(0);
    expect(entries[1].seq).toBe(1);
    expect(entries[1].prevHash).toHaveLength(64);
  });
});

describe('AuditLogger hash chain', () => {
  let logger: AuditLogger;
  let tmpDir: string;

  beforeEach(() => {
    logger = new AuditLogger();
    tmpDir = mkdtempSync(join(tmpdir(), 'ainonymous-chain-'));
    logger.enablePersistence(tmpDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('assigns monotonic seq numbers', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'k',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'e',
      offset: 0,
      length: 1,
    });
    const entries = logger.entries();
    expect(entries[0].seq).toBe(0);
    expect(entries[1].seq).toBe(1);
  });

  it('links each entry to the previous via prevHash', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'k',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'e',
      offset: 0,
      length: 1,
    });
    const entries = logger.entries();
    expect(entries[0].prevHash).toBe('');
    expect(entries[1].prevHash).toHaveLength(64);
    expect(entries[1].prevHash).not.toBe('');
  });

  it('verifyAuditChain returns null for intact persisted log', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'k',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'e',
      offset: 0,
      length: 1,
    });

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = join(tmpDir, `ainonymous-audit-${stamp}.jsonl`);
    const lines = readFileSync(file, 'utf-8').split('\n');
    expect(verifyAuditChain(lines)).toBeNull();
  });

  it('verifyAuditChain accepts session restart as valid boundary', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'k',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'e',
      offset: 0,
      length: 1,
    });
    logger.clear();
    logger.log({ original: 'c', pseudonym: 'z', layer: 'code', type: 'i', offset: 0, length: 1 });

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = join(tmpDir, `ainonymous-audit-${stamp}.jsonl`);
    const lines = readFileSync(file, 'utf-8').split('\n');
    // three entries: seq 0, 1, then 0 again after clear() - chain stays valid
    expect(verifyAuditChain(lines)).toBeNull();
  });

  it('verifyAuditChain returns early on malformed JSON', () => {
    const bad = ['not valid json at all'];
    expect(verifyAuditChain(bad)).toBe(0);
  });

  it('verifyAuditChain detects tampering of non-terminal entries', () => {
    logger.log({
      original: 'a',
      pseudonym: 'x',
      layer: 'secrets',
      type: 'k',
      offset: 0,
      length: 1,
    });
    logger.log({
      original: 'b',
      pseudonym: 'y',
      layer: 'identity',
      type: 'e',
      offset: 0,
      length: 1,
    });
    logger.log({ original: 'c', pseudonym: 'z', layer: 'code', type: 'i', offset: 0, length: 1 });

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const file = join(tmpDir, `ainonymous-audit-${stamp}.jsonl`);
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);

    // tamper: change pseudonym in first entry; second entry's prevHash will no longer match
    const first = JSON.parse(lines[0]);
    first.pseudonym = 'tampered';
    lines[0] = JSON.stringify(first);

    // chain breaks at seq=1 because its prevHash was computed from untampered first entry
    expect(verifyAuditChain(lines)).toBe(1);
  });
});
