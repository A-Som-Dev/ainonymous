import { describe, it, expect } from 'vitest';
import { normalizeForDetection } from '../../src/patterns/normalize.js';

describe('normalizeForDetection Cf category strip', () => {
  it('strips Arabic Letter Mark U+061C', () => {
    const n = normalizeForDetection('Art\u061Cur');
    expect(n.normalized).toBe('Artur');
  });

  it('strips Mongolian Vowel Separator U+180E', () => {
    const n = normalizeForDetection('Art\u180Eur');
    expect(n.normalized).toBe('Artur');
  });

  it('strips Interlinear Annotation Anchor U+FFF9', () => {
    const n = normalizeForDetection('Thomas\uFFF9Mueller');
    expect(n.normalized).toBe('ThomasMueller');
  });

  it('strips Interlinear Annotation Separator U+FFFA', () => {
    const n = normalizeForDetection('Thomas\uFFFAMueller');
    expect(n.normalized).toBe('ThomasMueller');
  });

  it('strips Interlinear Annotation Terminator U+FFFB', () => {
    const n = normalizeForDetection('Thomas\uFFFBMueller');
    expect(n.normalized).toBe('ThomasMueller');
  });

  it('strips Hangul Jungseong Filler U+1160 (width-0 Lo)', () => {
    const n = normalizeForDetection('Art\u1160ur');
    expect(n.normalized).toBe('Artur');
  });

  it('strips Hangul Choseong Filler U+115F (width-0 Lo)', () => {
    const n = normalizeForDetection('Art\u115Fur');
    expect(n.normalized).toBe('Artur');
  });

  it('strips combined Cf mix end-to-end', () => {
    const n = normalizeForDetection('Art\u061C\u180E\uFFF9\u1160ur');
    expect(n.normalized).toBe('Artur');
  });

  it('offsets still map back into original for Cf chars', () => {
    const src = 'Art\u061Cur';
    const n = normalizeForDetection(src);
    expect(n.normalized).toBe('Artur');
    // Index of 'u' in normalized is 3; in original it is 4 (after U+061C).
    expect(n.originalPos?.[3]).toBe(4);
  });

  it('keeps pre-existing Cf coverage intact', () => {
    const n = normalizeForDetection('admin\u202E@evil.com');
    expect(n.normalized).toBe('admin@evil.com');
  });

  it('strips Combining Grapheme Joiner U+034F (width-0 Mn)', () => {
    // CGJ is category Mn but width-0 by design (invisible joiner for shaping).
    // Not Cf, not a variation selector - so a blanket Cf strip misses it.
    const n = normalizeForDetection('Art\u034Fur');
    expect(n.normalized).toBe('Artur');
  });
});
