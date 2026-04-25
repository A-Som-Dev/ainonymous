import type { OrPostFilter } from './types.js';
import { alwaysDisabled } from './always-disabled.js';
import { countryIds } from './country-ids.js';
import { creditCard } from './credit-card.js';

export { runFilters } from './types.js';
export type { OrPostFilter, OrFilterContext } from './types.js';

export const BUILT_IN_OR_FILTERS: OrPostFilter[] = [alwaysDisabled, countryIds, creditCard];
export const DEFAULT_OR_FILTERS: OrPostFilter[] = BUILT_IN_OR_FILTERS;

export interface FilterSelectionOptions {
  /** Ids listed here are removed from the effective chain. */
  disable?: readonly string[];
  /** User-supplied or project-local extensions appended after built-ins. */
  extra?: readonly OrPostFilter[];
}

export function selectFilters(
  opts: FilterSelectionOptions = {},
  source: readonly OrPostFilter[] = BUILT_IN_OR_FILTERS,
): OrPostFilter[] {
  const disabled = new Set(opts.disable ?? []);
  const chain = source.filter((f) => !disabled.has(f.id));
  if (opts.extra && opts.extra.length > 0) chain.push(...opts.extra);
  const seen = new Set<string>();
  const unique: OrPostFilter[] = [];
  for (const f of chain) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }
  return unique;
}
