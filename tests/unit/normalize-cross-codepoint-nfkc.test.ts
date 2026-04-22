import { describe, it, expect } from 'vitest';
import { normalizeForDetection, mapMatchToOriginal } from '../../src/patterns/normalize.js';

describe('normalizeForDetection cross-codepoint NFKC', () => {
  it('composes Hangul Jamo L+V into the precomposed syllable', () => {
    // U+1100 (L-jamo) + U+1161 (V-jamo) should NFKC-compose to U+AC00.
    const n = normalizeForDetection('\u1100\u1161');
    expect(n.normalized).toBe('\uAC00');
  });

  it('matches precomposed Hangul against jamo-decomposed input', () => {
    const composed = '\uAC00';
    const decomposed = '\u1100\u1161';
    const n = normalizeForDetection(decomposed);
    expect(n.normalized.includes(composed)).toBe(true);
  });

  it('composes Hangul Jamo L+V+T triplets', () => {
    // U+1100 + U+1161 + U+11A8 (T-jamo, kiyeok) -> U+AC01 (GAG).
    const n = normalizeForDetection('\u1100\u1161\u11A8');
    expect(n.normalized).toBe('\uAC01');
  });

  it('keeps positions mappable after cross-codepoint composition', () => {
    const n = normalizeForDetection('\u1100\u1161');
    expect(n.normalized).toBe('\uAC00');
    const mapped = mapMatchToOriginal(n, 0, 1);
    expect(mapped.start).toBe(0);
  });

  it('preserves existing Cf strip behavior alongside composition', () => {
    // Leading Cf (ZWSP) plus jamo-decomposed Hangul.
    const n = normalizeForDetection('\u200B\u1100\u1161');
    expect(n.normalized).toBe('\uAC00');
  });

  it('does not swallow plain Latin neighbours of a composed segment', () => {
    const n = normalizeForDetection('a\u1100\u1161b');
    expect(n.normalized).toBe('a\uAC00b');
  });
});
