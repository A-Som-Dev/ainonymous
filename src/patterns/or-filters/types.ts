import type { PatternMatch } from '../utils.js';

export interface OrFilterContext {
  /** Lower-cased compliance preset name from behavior.compliance, '' when unset. */
  preset: string;
}

export interface OrPostFilter {
  /** Stable identifier for logging and config overrides. */
  readonly id: string;
  /** Returns true to keep the match, false to drop it. */
  accept(match: PatternMatch, ctx: OrFilterContext): boolean;
}

export function runFilters(
  filters: OrPostFilter[],
  matches: PatternMatch[],
  ctx: OrFilterContext,
): PatternMatch[] {
  return matches.filter((m) => filters.every((f) => f.accept(m, ctx)));
}
