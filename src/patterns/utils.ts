import { normalizeForDetection, mapMatchToOriginal } from './normalize.js';

export interface PatternMatch {
  type: string;
  match: string;
  offset: number;
  length: number;
}

export interface PatternRule {
  type: string;
  regex: RegExp;
  filter?: (match: string) => boolean;
}

export function runPatterns(input: string, patterns: PatternRule[]): PatternMatch[] {
  const norm = normalizeForDetection(input);
  const results: PatternMatch[] = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm.normalized)) !== null) {
      const val = m[0];
      if (val.length === 0) {
        re.lastIndex = m.index + 1;
        continue;
      }
      if (pattern.filter && !pattern.filter(val)) continue;
      const { start, length } = mapMatchToOriginal(norm, m.index, val.length);
      const originalSlice = input.slice(start, start + length);
      results.push({ type: pattern.type, match: originalSlice, offset: start, length });
    }
  }
  return results;
}

export function mergeMatches(primary: PatternMatch[], secondary: PatternMatch[]): PatternMatch[] {
  const merged = [...primary];

  for (const hit of secondary) {
    const dominated = primary.some(
      (p) => p.offset <= hit.offset && p.offset + p.length >= hit.offset + hit.length,
    );
    if (!dominated) {
      merged.push(hit);
    }
  }

  return merged;
}
