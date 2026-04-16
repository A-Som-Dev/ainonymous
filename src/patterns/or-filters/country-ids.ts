import type { OrPostFilter } from './types.js';

const COUNTRY_ID_TYPES = new Set([
  'australian-medicare',
  'australian-tfn',
  'canadian-sin',
  'brazilian-cpf',
  'brazilian-cnpj',
  'mexican-curp',
  'mexican-rfc',
  'south-korean-rrn',
  'south-africa-id',
  'indonesia-nik',
  'india-aadhaar',
  'india-pan',
  'hungarian-tax-id',
  'hungarian-personal-id',
  'ssn',
  'driving-license-us',
  'passport-us',
]);

const PRESET_ENABLED: Record<string, Set<string>> = {
  hipaa: new Set(['ssn', 'driving-license-us', 'passport-us']),
  ccpa: new Set(['ssn', 'driving-license-us', 'passport-us']),
  healthcare: new Set(['ssn']),
  'pci-dss': new Set(),
  finance: new Set(),
  gdpr: new Set(),
};

export const countryIds: OrPostFilter = {
  id: 'country-ids',
  accept(match, ctx) {
    if (!COUNTRY_ID_TYPES.has(match.type)) return true;
    return PRESET_ENABLED[ctx.preset]?.has(match.type) ?? false;
  },
};
