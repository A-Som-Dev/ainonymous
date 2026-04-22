import { describe, it, expect } from 'vitest';
import { detectNames } from '../../src/patterns/ner.js';

describe('NER name slice is normalized so SessionMap keys are stable across ZWS variants', () => {
  it('returns the same name for `Thomas\\u200BMueller` as for `Thomas Mueller`', () => {
    const dirty = detectNames('Kontakt: Thomas​Mueller');
    const clean = detectNames('Kontakt: Thomas Mueller');
    expect(dirty.length).toBeGreaterThan(0);
    expect(clean.length).toBeGreaterThan(0);
    const dirtyName = dirty.find((h) => h.name.includes('Mueller'))!.name;
    const cleanName = clean.find((h) => h.name.includes('Mueller'))!.name;
    expect(dirtyName).toBe(cleanName);
    expect(dirtyName).not.toMatch(/[​‌‍﻿]/);
  });

  it('strips ZWJ inside a person name as well', () => {
    const hits = detectNames('Kontakt: Peter‍Grossmann');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).not.toMatch(/[​‌‍﻿]/);
  });
});
