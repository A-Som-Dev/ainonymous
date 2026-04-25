import type { PatternMatch } from '../utils.js';

export interface OrFilterContext {
  /** Lower-cased compliance preset name from behavior.compliance, '' when unset. */
  preset: string;
}

export interface OrPostFilter {
  /** Stable identifier for logging and config overrides. */
  readonly id: string;
  /** Human-readable summary surfaced by `ainonymous filters list`. */
  readonly description?: string;
  /** Returns true to keep the match, false to drop it. */
  accept(match: PatternMatch, ctx: OrFilterContext): boolean;
}

const reportedThrowers = new Set<string>();

export function runFilters(
  filters: OrPostFilter[],
  matches: PatternMatch[],
  ctx: OrFilterContext,
): PatternMatch[] {
  return matches.filter((m) =>
    filters.every((f) => {
      try {
        return f.accept(m, ctx);
      } catch (err) {
        // A filter that throws must not tear down the whole request. We fall
        // back to the safer default (keep the match so detection-layer logic
        // still runs) and warn once per filter id so a loop does not spam.
        if (!reportedThrowers.has(f.id)) {
          reportedThrowers.add(f.id);
          console.warn(
            `[ainonymous] filter "${f.id}" threw; keeping match. ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        return true;
      }
    }),
  );
}
