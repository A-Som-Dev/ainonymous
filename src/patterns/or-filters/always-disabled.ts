import type { OrPostFilter } from './types.js';

// OpenRedaction's `person-name` is too greedy on multi-word capword phrases,
// it re-anonymises already-replaced pseudonyms. Disabled until a tighter
// shape filter is available.
const ALWAYS_DISABLED = new Set([
  'zip-code-us',
  'zip-code',
  'date',
  'instagram-username',
  'twitter-username',
  'tiktok-username',
  'facebook-username',
  'social-media-username',
  'name',
  'person-name',
  'phone',
  'heroku-api-key',
]);

export const alwaysDisabled: OrPostFilter = {
  id: 'always-disabled',
  description:
    'Drops detection types whose shape collides with ordinary code or prose (zip codes, plain phone numbers, greedy person-name).',
  accept(match) {
    return !ALWAYS_DISABLED.has(match.type);
  },
};
