import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCustomFilters, UnsignedFilterError } from '../../src/patterns/or-filters/loader.js';
import { selectFilters, BUILT_IN_OR_FILTERS } from '../../src/patterns/or-filters/index.js';

describe('or-filters custom loader', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ain-or-custom-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to load an unsigned local filter without allow_unsigned_local', async () => {
    const p = join(dir, 'my-filter.mjs');
    writeFileSync(p, `export default { id: 'my-filter', accept: () => true };`, 'utf-8');
    await expect(
      loadCustomFilters([{ path: p, allowUnsignedLocal: false }], dir),
    ).rejects.toBeInstanceOf(UnsignedFilterError);
  });

  it('loads a valid unsigned filter when the trust flag is set', async () => {
    const p = join(dir, 'my-filter.mjs');
    writeFileSync(
      p,
      `export default {
         id: 'drop-example',
         description: 'example',
         accept: (m) => m.type !== 'example',
       };`,
      'utf-8',
    );
    const loaded = await loadCustomFilters([{ path: p, allowUnsignedLocal: true }], dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].filter.id).toBe('drop-example');
  });

  it('rejects a filter missing the id field', async () => {
    const p = join(dir, 'bad.mjs');
    writeFileSync(p, `export default { accept: () => true };`, 'utf-8');
    await expect(loadCustomFilters([{ path: p, allowUnsignedLocal: true }], dir)).rejects.toThrow(
      /id/,
    );
  });

  it('selectFilters drops built-ins listed in disable and appends extras', () => {
    const extra = { id: 'x-extra', accept: () => true };
    const chain = selectFilters(
      { disable: ['always-disabled'], extra: [extra] },
      BUILT_IN_OR_FILTERS,
    );
    expect(chain.map((f) => f.id)).not.toContain('always-disabled');
    expect(chain.map((f) => f.id)).toContain('x-extra');
  });
});
