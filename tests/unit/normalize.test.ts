import { describe, it, expect } from 'vitest';
import { normalizeForDetection, mapMatchToOriginal } from '../../src/patterns/normalize.js';

describe('normalizeForDetection', () => {
  it('passes plain ASCII through unchanged', () => {
    const n = normalizeForDetection('hello world');
    expect(n.normalized).toBe('hello world');
    // ASCII fast path: identity map, positions resolve via mapMatchToOriginal
    for (let i = 0; i < 11; i++) {
      expect(mapMatchToOriginal(n, i, 1)).toEqual({ start: i, length: 1 });
    }
  });

  it('returns empty result for empty input', () => {
    const n = normalizeForDetection('');
    expect(n.normalized).toBe('');
  });

  it('strips zero-width space', () => {
    const n = normalizeForDetection('api\u200Bkey');
    expect(n.normalized).toBe('apikey');
    // positions of 'apikey' map back to the original: a(0) p(1) i(2) k(4) e(5) y(6)
    expect(n.originalPos).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it('strips zero-width non-joiner, joiner, and BOM', () => {
    const n = normalizeForDetection('a\u200Cb\u200Dc\uFEFFd');
    expect(n.normalized).toBe('abcd');
    expect(n.originalPos).toEqual([0, 2, 4, 6]);
  });

  it('expands ligatures via compatibility decomposition', () => {
    // U+FB01 (fi ligature) maps to "fi" under NFKC
    const n = normalizeForDetection('\uFB01nd');
    expect(n.normalized).toBe('find');
    // 'f' and 'i' both originate at index 0 (the ligature); 'n','d' at 1,2
    expect(n.originalPos).toEqual([0, 0, 1, 2]);
  });

  it('keeps precomposed accented characters intact', () => {
    // U+00E9 (é) stays composed under NFKC so that patterns with literal é/ü/ä
    // in character classes keep working on normalized text.
    const n = normalizeForDetection('café');
    expect(n.normalized).toBe('café');
    expect(n.originalPos).toEqual([0, 1, 2, 3]);
  });

  it('keeps German umlauts intact so address patterns still match', () => {
    const n = normalizeForDetection('Müller');
    expect(n.normalized).toBe('Müller');
    expect(n.originalPos).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('combines ligature expansion with zero-width stripping', () => {
    // "fi" ligature + ZWJ + 'x'
    const n = normalizeForDetection('\uFB01\u200Dx');
    expect(n.normalized).toBe('fix');
    expect(n.originalPos).toEqual([0, 0, 2]);
  });

  it('folds fullwidth Latin into ASCII', () => {
    // U+FF53 (s) U+FF45 (e) U+FF43 (c) U+FF52 (r) U+FF45 (e) U+FF54 (t)
    const n = normalizeForDetection('\uFF53\uFF45\uFF43\uFF52\uFF45\uFF54');
    expect(n.normalized).toBe('secret');
    expect(n.originalPos).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('uses identity map for pure ASCII (no position array allocated)', () => {
    const n = normalizeForDetection('just ascii here');
    expect(n.originalPos).toBeUndefined();
  });
});

describe('mapMatchToOriginal', () => {
  it('is idempotent for pure ASCII ranges', () => {
    const n = normalizeForDetection('hello world');
    const { start, length } = mapMatchToOriginal(n, 6, 5);
    expect(start).toBe(6);
    expect(length).toBe(5);
  });

  it('maps a zero-length match', () => {
    const n = normalizeForDetection('abc');
    const { start, length } = mapMatchToOriginal(n, 1, 0);
    expect(start).toBe(1);
    expect(length).toBe(0);
  });

  it('maps back across a stripped zero-width', () => {
    const n = normalizeForDetection('api\u200Bkey');
    // normalized 'apikey' match at pos 0, len 6 → original 'api\u200Bkey' pos 0, len 7
    const { start, length } = mapMatchToOriginal(n, 0, 6);
    expect(start).toBe(0);
    expect(length).toBe(7);
  });

  it('maps a sub-range that spans a stripped char', () => {
    const n = normalizeForDetection('a\u200Bb\u200Bc');
    // normalized 'abc' match pos 1, len 2 ("bc") → original 'b\u200Bc' at offset 2, length 3
    const { start, length } = mapMatchToOriginal(n, 1, 2);
    expect(start).toBe(2);
    expect(length).toBe(3);
  });

  it('maps back across a ligature expansion', () => {
    // '\uFB01nd' normalizes to "find". Match "fi" at normalized pos 0, len 2
    // maps to the single ligature codepoint in the original: start 0, length 1.
    const n = normalizeForDetection('\uFB01nd');
    const { start, length } = mapMatchToOriginal(n, 0, 2);
    expect(start).toBe(0);
    expect(length).toBe(1);
  });

  it('maps a match that covers the whole string', () => {
    const n = normalizeForDetection('api\u200Bkey');
    const { start, length } = mapMatchToOriginal(n, 0, n.normalized.length);
    expect(start).toBe(0);
    expect(length).toBe(7);
  });
});
