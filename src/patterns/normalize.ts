const INVISIBLE_SINGLE: ReadonlySet<string> = new Set([
  '\u200B',
  '\u200C',
  '\u200D',
  '\u200E',
  '\u200F',
  '\u202A',
  '\u202B',
  '\u202C',
  '\u202D',
  '\u202E',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
  '\uFEFF',
]);

function isVariationSelector(cp: number): boolean {
  return cp >= 0xfe00 && cp <= 0xfe0f;
}

function isTagChar(cp: number): boolean {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

function shouldStrip(ch: string): boolean {
  if (INVISIBLE_SINGLE.has(ch)) return true;
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  if (isVariationSelector(cp)) return true;
  if (isTagChar(cp)) return true;
  return false;
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

    if (shouldStrip(ch)) {
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
