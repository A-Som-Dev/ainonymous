import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { AuditLogger } from '../../src/audit/logger.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';
import type { AuditEntry } from '../../src/types.js';

function hashOf(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

function readAll(dir: string): AuditEntry[] {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const file = join(dir, `ainonymous-audit-${stamp}.jsonl`);
  const raw = readFileSync(file, 'utf-8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEntry);
}

function pendingHashes(entries: AuditEntry[]): Set<string> {
  const anonymized = new Map<string, AuditEntry>();
  const rehydrated = new Set<string>();
  for (const e of entries) {
    if (e.layer === 'rehydration') rehydrated.add(e.originalHash);
    else if (!anonymized.has(e.originalHash)) anonymized.set(e.originalHash, e);
  }
  const out = new Set<string>();
  for (const hash of anonymized.keys()) {
    if (!rehydrated.has(hash)) out.add(hash);
  }
  return out;
}

describe('audit pending (integration)', () => {
  let dir: string;

  beforeAll(async () => {
    await initParser();
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ainonymous-pending-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('shows 0 pending when every anonymized original is rehydrated', async () => {
    const logger = new AuditLogger();
    logger.enablePersistence(dir);

    const config = {
      ...getDefaults(),
      identity: { company: 'AcmeCorp', domains: [], people: ['Artur Sommer'] },
    };
    const pipeline = new Pipeline(config, logger);

    const result = await pipeline.anonymize('AcmeCorp hired Artur Sommer last week');
    expect(result.replacements.length).toBeGreaterThan(0);

    const rehydrated = pipeline.rehydrate(result.text);
    expect(rehydrated).toContain('AcmeCorp');
    expect(rehydrated).toContain('Artur Sommer');

    const entries = readAll(dir);
    const pending = pendingHashes(entries);
    expect(pending.size).toBe(0);
  });

  it('shows all anonymized as pending when rehydrate never runs', async () => {
    const logger = new AuditLogger();
    logger.enablePersistence(dir);

    const config = {
      ...getDefaults(),
      identity: { company: 'AcmeCorp', domains: [], people: ['Artur Sommer', 'Bob Miller'] },
    };
    const pipeline = new Pipeline(config, logger);

    const result = await pipeline.anonymize('AcmeCorp hired Artur Sommer and Bob Miller');
    expect(result.replacements.length).toBeGreaterThan(0);

    const entries = readAll(dir);
    const pending = pendingHashes(entries);
    const uniqueOriginals = new Set(
      entries.filter((e) => e.layer !== 'rehydration').map((e) => e.originalHash),
    );
    expect(pending.size).toBe(uniqueOriginals.size);
    expect(pending.size).toBeGreaterThan(0);
  });

  it('marks only the pseudonyms absent from the response as pending', async () => {
    const logger = new AuditLogger();
    logger.enablePersistence(dir);

    const config = {
      ...getDefaults(),
      identity: { company: 'AcmeCorp', domains: [], people: ['Artur Sommer', 'Bob Miller'] },
    };
    const pipeline = new Pipeline(config, logger);

    const r1 = await pipeline.anonymize('Artur Sommer says hi');
    const r2 = await pipeline.anonymize('Bob Miller says bye');
    expect(r1.replacements.length).toBeGreaterThan(0);
    expect(r2.replacements.length).toBeGreaterThan(0);

    // LLM response only references the first pseudonym; the second stays pending.
    pipeline.rehydrate(r1.text);

    const entries = readAll(dir);
    const pending = pendingHashes(entries);
    expect(pending.has(hashOf('Bob Miller'))).toBe(true);
    expect(pending.has(hashOf('Artur Sommer'))).toBe(false);
  });
});
