import { foldConfusable } from './confusables.js';

const CF_RE = /^\p{Cf}$/u;

// Variation Selectors are Mn (nonspacing marks), not Cf. Stripping the whole
// Mn category would eat legitimate combining accents, so pin the two VS blocks.
function isVariationSelector(cp: number): boolean {
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true;
  return false;
}

// Width-zero codepoints that render as nothing on every shipping font but are
// NOT in category Cf. Kept as an explicit allow-list because the surrounding
// categories (Lo, Mn) also contain legitimate glyphs that must survive.
const WIDTH_ZERO_EXTRA: ReadonlySet<number> = new Set([
  0x115f, // Hangul Choseong Filler (Lo)
  0x1160, // Hangul Jungseong Filler (Lo)
  0x3164, // Hangul Filler (Lo)
  0xffa0, // Halfwidth Hangul Filler (Lo)
  0x034f, // Combining Grapheme Joiner (Mn, width-0 by design)
]);

function shouldStrip(ch: string, cp: number): boolean {
  if (CF_RE.test(ch)) return true;
  if (isVariationSelector(cp)) return true;
  return WIDTH_ZERO_EXTRA.has(cp);
}

export interface NormalizedText {
  normalized: string;
  originalPos: number[] | undefined;
}

function isPureAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function normalizeForDetection(original: string): NormalizedText {
  if (isPureAscii(original)) {
    return { normalized: original, originalPos: undefined };
  }

  const out: string[] = [];
  const pos: number[] = [];

  for (const { segment, index } of graphemeSegmenter.segment(original)) {
    let stripped = '';
    let j = 0;
    while (j < segment.length) {
      const cp = segment.codePointAt(j);
      if (cp === undefined) {
        j++;
        continue;
      }
      const ch = String.fromCodePoint(cp);
      if (!shouldStrip(ch, cp)) stripped += ch;
      j += ch.length;
    }
    if (stripped.length === 0) continue;

    const normalized = stripped.normalize('NFKC');
    let k = 0;
    while (k < normalized.length) {
      const cp = normalized.codePointAt(k);
      if (cp === undefined) {
        k++;
        continue;
      }
      const width = cp > 0xffff ? 2 : 1;
      const folded = foldConfusable(cp);
      if (folded !== undefined) {
        for (let f = 0; f < folded.length; f++) {
          out.push(folded[f]);
          pos.push(index);
        }
      } else {
        for (let w = 0; w < width; w++) {
          out.push(normalized[k + w]);
          pos.push(index);
        }
      }
      k += width;
    }
  }

  return { normalized: out.join(''), originalPos: pos };
}

// Drop width-0 format / variation / filler codepoints without NFKC or
// confusable folding. Used on the rehydrate side so smuggled ZWJ/ZWNJ/CGJ
// sequences inside a pseudonym still line up with the session map, while
// legitimate non-Latin content in the upstream response is left alone.
export function stripFormatChars(s: string): string {
  if (isPureAscii(s)) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    if (cp === undefined) {
      i++;
      continue;
    }
    const ch = String.fromCodePoint(cp);
    if (!shouldStrip(ch, cp)) out += ch;
    i += ch.length;
  }
  return out;
}

export function mapMatchToOriginal(
  n: NormalizedText,
  normalizedStart: number,
  normalizedLen: number,
): { start: number; length: number } {
  if (n.originalPos === undefined) {
    return { start: normalizedStart, length: normalizedLen };
  }

  if (normalizedLen === 0) {
    return { start: n.originalPos[normalizedStart] ?? 0, length: 0 };
  }

  const start = n.originalPos[normalizedStart] ?? 0;
  const lastIdx = normalizedStart + normalizedLen - 1;
  const lastOriginal = n.originalPos[lastIdx] ?? start;
  return { start, length: lastOriginal - start + 1 };
}
