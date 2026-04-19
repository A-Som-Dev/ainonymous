import { describe, it, expect } from 'vitest';
import { normalizeForDetection } from '../../src/patterns/normalize.js';

describe('normalizeForDetection Unicode umbrella', () => {
  it('strips bidi override U+202A..U+202E', () => {
    const input = 'admin\u202E@evil.com';
    const n = normalizeForDetection(input);
    expect(n.normalized).toBe('admin@evil.com');
  });

  it('strips bidi isolate U+2066..U+2069', () => {
    const input = 'secret\u2066token\u2069';
    const n = normalizeForDetection(input);
    expect(n.normalized).toBe('secrettoken');
  });

  it('strips tag characters U+E0000..U+E007F', () => {
    const input = 'user\u{E0041}\u{E0042}@example.com';
    const n = normalizeForDetection(input);
    expect(n.normalized).toBe('user@example.com');
  });

  it('strips variation selectors U+FE00..U+FE0F', () => {
    const input = 'card\uFE0F-4111';
    const n = normalizeForDetection(input);
    expect(n.normalized).toBe('card-4111');
  });

  it('folds mathematical alphanumeric (U+1D400..U+1D7FF) to ascii via NFKC', () => {
    // Mathematical bold 'P' (U+1D5E3) + 'a' (U+1D5EE) + 's' (U+1D600) + 's' + 'w' + 'o' + 'r' + 'd'
    const input = '\u{1D5E3}\u{1D5EE}\u{1D600}\u{1D600}\u{1D604}\u{1D5FC}\u{1D5FF}\u{1D5F1}';
    const n = normalizeForDetection(input);
    expect(n.normalized).toBe('Password');
  });

  it('preserves regular ascii characters exactly', () => {
    const n = normalizeForDetection('hello world 42');
    expect(n.normalized).toBe('hello world 42');
  });

  it('handles mixed bidi + zero-width + tag chars', () => {
    const input = 'tok\u200Ben\u202A\u{E0041}payload';
    const n = normalizeForDetection(input);
    expect(n.normalized).toBe('tokenpayload');
  });
});
