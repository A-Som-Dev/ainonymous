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

export function normalizeForDetection(original: string): NormalizedText {
  if (isPureAscii(original)) {
    return { normalized: original, originalPos: undefined };
  }

  const out: string[] = [];
  const pos: number[] = [];

  let i = 0;
  while (i < original.length) {
    const cp = original.codePointAt(i);
    if (cp === undefined) {
      i++;
      continue;
    }
    const ch = String.fromCodePoint(cp);
    const advance = ch.length;

    if (shouldStrip(ch, cp)) {
      i += advance;
      continue;
    }

    const mapped = ch.normalize('NFKC');
    for (let j = 0; j < mapped.length; j++) {
      out.push(mapped[j]);
      pos.push(i);
    }

    i += advance;
  }

  return { normalized: out.join(''), originalPos: pos };
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
