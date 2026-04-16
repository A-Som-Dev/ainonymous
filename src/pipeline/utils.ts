import type { PatternMatch } from '../patterns/utils.js';

export function removeOverlaps(matches: PatternMatch[]): PatternMatch[] {
  if (matches.length <= 1) return matches;

  const sorted = [...matches].sort((a, b) => a.offset - b.offset);
  const kept: PatternMatch[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = kept[kept.length - 1];
    const cur = sorted[i];
    const prevEnd = prev.offset + prev.length;

    if (cur.offset >= prevEnd) {
      kept.push(cur);
    } else if (cur.length > prev.length) {
      kept[kept.length - 1] = cur;
    }
  }

  return kept;
}
