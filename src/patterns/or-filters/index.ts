import type { OrPostFilter } from './types.js';
import { alwaysDisabled } from './always-disabled.js';
import { countryIds } from './country-ids.js';
import { creditCard } from './credit-card.js';

export { runFilters } from './types.js';
export type { OrPostFilter, OrFilterContext } from './types.js';

export const DEFAULT_OR_FILTERS: OrPostFilter[] = [alwaysDisabled, countryIds, creditCard];
