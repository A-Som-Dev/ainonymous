// Unicode normalization for pattern matching. Strips zero-width chars and applies
// NFKC per-codepoint so detectors aren't fooled by ligatures, fullwidth variants,
// or ZWJ-injected bypass payloads. We keep NFKC (compose) rather than NFKD so
// precomposed accents like "ü" stay intact - the German address patterns and similar
// rely on literal "ä/ö/ü" in their character classes. Confusables (kyrillisch vs
// lateinisch homoglyphs) are NOT handled here - that needs a separate mapping table
// and is tracked as future work in SECURITY.md.

const ZERO_WIDTH = new Set(['\u200B', '\u200C', '\u200D', '\uFEFF']);

export interface NormalizedText {
  /** NFKC-normalized input with zero-width characters stripped. */
  normalized: string;
  /** For each index in `normalized`, the index of the source codepoint in the
   *  original string. `undefined` signals an identity map (hot path for ASCII). */
  originalPos: number[] | undefined;
}

// U+0000..U+007F: plain ASCII, nothing to normalize, nothing to strip.
// Short-circuit with an identity map so the common case (English code bodies,
// JSON payloads) stays allocation-free beyond the NormalizedText wrapper.
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

  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (ZERO_WIDTH.has(ch)) continue;

    const mapped = ch.normalize('NFKC');
    // iterate code units so `pos` stays in lockstep with `normalized.length`
    for (let j = 0; j < mapped.length; j++) {
      out.push(mapped[j]);
      pos.push(i);
    }
  }

  return { normalized: out.join(''), originalPos: pos };
}

/** Convert a match found on `n.normalized` back to start/length in the original string. */
export function mapMatchToOriginal(
  n: NormalizedText,
  normalizedStart: number,
  normalizedLen: number,
): { start: number; length: number } {
  // identity map: original indices == normalized indices
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
