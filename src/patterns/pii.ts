import { detectWithOpenRedaction } from './openredaction-bridge.js';
import { mergeMatches, runPatterns, type PatternMatch, type PatternRule } from './utils.js';

function luhnValid(digits: string): boolean {
  // Standard Luhn mod-10. Returns true for real card numbers and rejects
  // random digit sequences that only look like credit cards.
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (doubleIt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}

export const PII_PATTERNS: PatternRule[] = [
  {
    type: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    type: 'phone',
    // international (+49 ...) or double-zero (0049 ...) or German mobile
    // prefixes 015x/016x/017x. Festnetz vorwahlen (030, 040, 089, ...) are
    // intentionally left out. they collide with UIDs in code and need an
    // identity.people / identity.domains entry or a custom secret pattern
    // to be recognized reliably. See learnings/v1.2-redteam-bypasses.md.
    regex: /(?<!\d)(?:\+\d{1,3}|00\d{1,3}|01[5-7]\d)[\s/\-()]*\d[\d\s/\-()]{5,14}\d(?!\d)/g,
  },
  {
    type: 'phone',
    // Landline numbers need a prefix word (Tel/Fax/Hotline/...) to avoid
    // matching product numbers and other numeric IDs.
    regex:
      /(?<=\b(?:Tel|Telefon|Telefonnummer|Telefon-Nr|Fax|Hotline|Service|Mobil|Mobile|Handy|Phone|Mob\.|Tel\.)\.?\s*[:.\-]?\s*)(?:\+?\d[\d\s/\-().]{7,18}\d)/gi,
  },
  {
    type: 'iban',
    regex: /[A-Z]{2}\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2,4}/g,
  },
  {
    // Jira-style issue key, 2 to 10 uppercase letters + dash + digits.
    // 1-letter prefixes collide with ICD disease codes so the lower bound is 2.
    type: 'ticket-jira',
    regex: /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g,
  },
  {
    // Hash-prefixed ticket IDs (#1234) need a context word in front, bare #NNN
    // collides with HTTP status codes, anchors and CSS colours.
    type: 'ticket-hash',
    regex:
      /(?<=\b(?:ticket|tickets|issue|issues|PR|PRs|MR|MRs|bug|bugs|fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved|ref|references?|see|pull\s+request|pullrequest)\s+)#\d{1,8}\b/gi,
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
    // Match 13-19 digit card numbers with optional separators every 4 digits.
    // Accept space/dash/dot only. slash/pipe/colon/underscore appear in URL
    // paths and log prefixes where a Luhn-valid subsequence is an unavoidable
    // false positive. Nakedly concatenated cards stay matched via the
    // no-separator alternative. Luhn is the real guard.
    type: 'credit-card',
    regex: /(?<!\d)\d{4}[\s\-.]?\d{4}[\s\-.]?\d{4}[\s\-.]?\d{1,7}(?!\d)/g,
    filter: (match) => luhnValid(match.replace(/\D/g, '')),
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

export async function matchPIIEnhanced(
  input: string,
  preset?: string,
  opts?: { filters?: readonly import('./or-filters/types.js').OrPostFilter[] },
): Promise<PatternMatch[]> {
  const local = matchPII(input);

  let orHits: PatternMatch[];
  try {
    const all = await detectWithOpenRedaction(input, {
      preset,
      filters: opts?.filters as never,
    });
    orHits = all.filter((h) => isPIIType(h.type));
  } catch (err) {
    if (process.env.DEBUG) console.warn('[ainonymous] openredaction error:', err);
    return local;
  }

  return mergeMatches(local, orHits);
}
