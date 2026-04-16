import { describe, it, expect } from 'vitest';
import { DEFAULT_OR_FILTERS, runFilters } from '../../src/patterns/or-filters/index.js';
import type { PatternMatch } from '../../src/patterns/utils.js';

function hit(type: string): PatternMatch {
  return { type, match: 'x', offset: 0, length: 1 };
}

describe('OR post-filter pipeline', () => {
  it('drops always-disabled types regardless of preset', () => {
    const hits = ['phone', 'person-name', 'name', 'date', 'heroku-api-key'].map(hit);
    const kept = runFilters(DEFAULT_OR_FILTERS, hits, { preset: 'hipaa' });
    expect(kept).toHaveLength(0);
  });

  it('drops person-name because OR matches are too loose on multi-word phrases', () => {
    const kept = runFilters(DEFAULT_OR_FILTERS, [hit('person-name')], { preset: '' });
    expect(kept).toHaveLength(0);
  });

  it('drops country-id types without matching preset', () => {
    const kept = runFilters(DEFAULT_OR_FILTERS, [hit('ssn'), hit('india-aadhaar')], {
      preset: '',
    });
    expect(kept).toHaveLength(0);
  });

  it('keeps SSN under hipaa preset', () => {
    const kept = runFilters(DEFAULT_OR_FILTERS, [hit('ssn')], { preset: 'hipaa' });
    expect(kept).toHaveLength(1);
  });

  it('keeps credit-card only under pci-dss / finance preset', () => {
    expect(runFilters(DEFAULT_OR_FILTERS, [hit('credit-card')], { preset: '' })).toHaveLength(0);
    expect(runFilters(DEFAULT_OR_FILTERS, [hit('credit-card')], { preset: 'pci-dss' })).toHaveLength(
      1,
    );
    expect(runFilters(DEFAULT_OR_FILTERS, [hit('credit-card')], { preset: 'finance' })).toHaveLength(
      1,
    );
  });

  it('keeps unrelated types through unchanged', () => {
    const kept = runFilters(DEFAULT_OR_FILTERS, [hit('email'), hit('iban')], {
      preset: '',
    });
    expect(kept).toHaveLength(2);
  });
});
