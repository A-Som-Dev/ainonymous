import { detectWithOpenRedaction } from './openredaction-bridge.js';
import { mergeMatches, runPatterns, type PatternMatch, type PatternRule } from './utils.js';

export const PII_PATTERNS: PatternRule[] = [
  {
    type: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    type: 'phone',
    regex: /(?:\+49|0049|0)\s*\d[\d\s/\-]{6,14}\d/g,
  },
  {
    type: 'iban',
    regex: /[A-Z]{2}\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2,4}/g,
  },
  {
    type: 'tax-id',
    regex: /\d{2}\/\d{3}\/\d{5}/g,
  },
  {
    type: 'sozialversicherung',
    regex: /\d{2}\s?\d{6}\s?[A-Z]\s?\d{3}/g,
  },
  {
    type: 'personalausweis',
    regex: /[CFGHJKLMNPRTVWXYZ0-9]{9}\d[dD]\s?<<\s?/g,
  },
  {
    type: 'address',
    regex:
      /(?:[A-ZÄÖÜa-zäöüß]+\s+)*[A-ZÄÖÜa-zäöüß]*(?:straße|str\.|weg|gasse|platz|allee|ring|damm)\s+\d+[a-z]?\s*,?\s*\d{5}\s+[A-ZÄÖÜa-zäöüß]+/gi,
  },
  {
    type: 'date-of-birth',
    regex: /(?:geboren|geb\.|DOB)[:\s]+\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/gi,
  },
  {
    type: 'credit-card',
    regex: /\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}/g,
  },
];

const PII_OR_TYPES = new Set([
  'email',
  'phone',
  'iban',
  'credit-card',
  'date-of-birth',
  'address',
  'tax-id',
  'person-name',
  'sozialversicherung',
  'personalausweis',
  'national-insurance-uk',
  'nhs-number',
  'passport-uk',
  'passport-us',
  'driving-license-uk',
  'driving-license-us',
  'postcode-uk',
  'ssn',
  'german-tax-id',
  'name',
  'date',
  'zip-code-us',
  'hungarian-tax-id',
  'hungarian-personal-id',
  'south-africa-id',
  'south-korean-rrn',
  'brazilian-cpf',
  'brazilian-cnpj',
  'mexican-curp',
  'mexican-rfc',
  'canadian-sin',
  'australian-tfn',
  'australian-medicare',
  'indonesia-nik',
  'india-aadhaar',
  'india-pan',
]);

function isPIIType(type: string): boolean {
  return PII_OR_TYPES.has(type);
}

export function matchPII(input: string): PatternMatch[] {
  return runPatterns(input, PII_PATTERNS);
}

export async function matchPIIEnhanced(input: string, preset?: string): Promise<PatternMatch[]> {
  const local = matchPII(input);

  let orHits: PatternMatch[];
  try {
    const all = await detectWithOpenRedaction(input, { preset });
    orHits = all.filter((h) => isPIIType(h.type));
  } catch (err) {
    if (process.env.DEBUG) console.warn('[ainonymity] openredaction error:', err);
    return local;
  }

  return mergeMatches(local, orHits);
}
