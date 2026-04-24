import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistStore } from '../../src/session/persist.js';

describe('PersistStore counter block reservation', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-counter-block-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('returns a starting offset of 1 when reserving from an empty store', () => {
    const dbPath = join(workdir, 'session.db');
    const store = new PersistStore(dbPath);
    const { start, end } = store.reserveCounterBlock('identifier', 10);
    expect(start).toBe(1);
    expect(end).toBe(10);
    store.close();
  });

  it('gives two processes non-overlapping blocks against the same DB file', () => {
    const dbPath = join(workdir, 'session.db');
    const store1 = new PersistStore(dbPath);
    const a = store1.reserveCounterBlock('identifier', 100);
    store1.close();

    const store2 = new PersistStore(dbPath);
    const b = store2.reserveCounterBlock('identifier', 100);
    store2.close();

    expect(a.start).toBe(1);
    expect(a.end).toBe(100);
    expect(b.start).toBe(101);
    expect(b.end).toBe(200);
  });

  it('keeps counters isolated per counter name', () => {
    const dbPath = join(workdir, 'session.db');
    const store = new PersistStore(dbPath);
    const id1 = store.reserveCounterBlock('identifier', 50);
    const person1 = store.reserveCounterBlock('person', 50);
    const id2 = store.reserveCounterBlock('identifier', 50);
    expect(id1.start).toBe(1);
    expect(person1.start).toBe(1);
    expect(id2.start).toBe(51);
    store.close();
  });

  it('rejects non-positive block sizes', () => {
    const dbPath = join(workdir, 'session.db');
    const store = new PersistStore(dbPath);
    expect(() => store.reserveCounterBlock('identifier', 0)).toThrow();
    expect(() => store.reserveCounterBlock('identifier', -1)).toThrow();
    store.close();
  });

  it('throws before advancing past Number.MAX_SAFE_INTEGER', () => {
    const dbPath = join(workdir, 'session.db');
    const store = new PersistStore(dbPath);
    // Raw upsert to prime the counter just below the safe limit
    const near = Number.MAX_SAFE_INTEGER - 5;
    (store as unknown as { counterUpsertStmt: { run: (...a: unknown[]) => void } }).counterUpsertStmt.run(
      'identifier',
      near,
      Date.now(),
    );
    expect(() => store.reserveCounterBlock('identifier', 100)).toThrow(/overflow/);
    store.close();
  });
});
