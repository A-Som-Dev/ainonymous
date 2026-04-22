import { describe, it, expect } from 'vitest';
import { normalizeForDetection } from '../../src/patterns/normalize.js';

describe('normalizeForDetection confusables', () => {
  it('folds LATIN SMALL LETTER LONG S U+017F to s', () => {
    const n = normalizeForDetection('\u017Fally.smith@acme.corp');
    expect(n.normalized.includes('sally.smith')).toBe(true);
  });

  it('folds LATIN SMALL LETTER DOTLESS I U+0131 to i', () => {
    const n = normalizeForDetection('adm\u0131n@acme.corp');
    expect(n.normalized.includes('admin')).toBe(true);
  });

  it('folds LATIN CAPITAL LETTER I WITH DOT ABOVE U+0130 to i', () => {
    const n = normalizeForDetection('\u0130nternal-acme');
    expect(n.normalized.toLowerCase().includes('internal')).toBe(true);
  });

  it('folds Cyrillic lowercase homoglyphs to Latin baseline', () => {
    // а=0430, е=0435, о=043E, р=0440, с=0441, х=0445, у=0443
    const n = normalizeForDetection('\u0430\u0435\u043E\u0440\u0441\u0445\u0443');
    expect(n.normalized).toBe('aeopcxy');
  });

  it('folds Cyrillic uppercase homoglyphs to Latin baseline', () => {
    // А=0410, В=0412, Е=0415, О=041E, Р=0420, С=0421, Т=0422, Х=0425, У=0423
    const n = normalizeForDetection('\u0410\u0412\u0415\u041E\u0420\u0421\u0422\u0425\u0423');
    expect(n.normalized).toBe('ABEOPCTXY');
  });

  it('catches Cyrillic homoglyph attacks on glossary terms', () => {
    // "acme" written with Cyrillic 'а' and 'е'
    const poisoned = '\u0430cm\u0435';
    const n = normalizeForDetection(poisoned);
    expect(n.normalized.includes('acme')).toBe(true);
  });

  it('leaves non-confusable Cyrillic characters intact', () => {
    // Cyrillic ю (U+044E) has no Latin confusable - must not be folded.
    const n = normalizeForDetection('\u044E');
    expect(n.normalized).toBe('\u044E');
  });

  it('folds confusables combined with Cf strip', () => {
    const n = normalizeForDetection('ad\u200Bm\u0131n');
    expect(n.normalized).toBe('admin');
  });

  it('folds Letterlike Symbols that NFKC misses', () => {
    // U+210E PLANCK CONSTANT (script h), U+212F SCRIPT SMALL E,
    // U+2134 SCRIPT SMALL O, U+2115 DOUBLE-STRUCK CAPITAL N,
    // U+210D DOUBLE-STRUCK CAPITAL H
    const n = normalizeForDetection('\u210E\u212F\u2134 \u2115\u210D');
    expect(n.normalized).toBe('heo NH');
  });

  it('folds Armenian homoglyphs', () => {
    // U+0555 Armenian capital Oh, U+0585 Armenian small oh
    const n = normalizeForDetection('\u0555\u0585');
    expect(n.normalized).toBe('Oo');
  });

  it('folds Cherokee A/E/I homoglyphs', () => {
    // U+13A0 Cherokee letter A, U+13A6 Cherokee letter E (rendered like E)
    const n = normalizeForDetection('\u13A0');
    expect(n.normalized).toBe('A');
  });

  it('folds Old Italic capital letters to Latin baseline', () => {
    // U+10300 Old Italic A, U+10308 Old Italic I, U+1030F Old Italic P-like (V).
    // Supplementary-plane codepoints must round-trip.
    const n = normalizeForDetection('\u{10300}\u{10308}');
    expect(n.normalized).toBe('AI');
  });

  it('folds Gothic letters that collide with Latin', () => {
    // U+10330 Gothic Ahsa (A), U+10343 Gothic Giba (G)
    const n = normalizeForDetection('\u{10330}');
    expect(n.normalized).toBe('A');
  });

  it('folds Deseret capital letters to Latin', () => {
    // U+10400 Deseret Capital Long I, rendered like Latin E
    const n = normalizeForDetection('\u{10400}');
    expect(n.normalized).toBe('E');
  });
});
