import { OpenRedaction } from 'openredaction';
import type { PatternMatch } from './utils.js';
import { DEFAULT_OR_FILTERS, runFilters, type OrPostFilter } from './or-filters/index.js';

type PresetName = 'gdpr' | 'hipaa' | 'ccpa' | 'healthcare' | 'finance' | 'pci-dss' | 'soc2';
type CompliancePreset = PresetName | undefined;

interface BridgeOptions {
  preset?: string;
  filters?: OrPostFilter[];
}

const detectors = new Map<string, OpenRedaction>();

function getDetector(preset?: string): OpenRedaction {
  const key = preset ?? '';
  let d = detectors.get(key);
  if (d) return d;
  d = new OpenRedaction({
    preset: preset as CompliancePreset,
    confidenceThreshold: 0.6,
    enableContextAnalysis: true,
    deterministic: true,
    includeNames: true,
    includeAddresses: true,
    includePhones: true,
    includeEmails: true,
  });
  detectors.set(key, d);
  return d;
}

// Concurrent callers with the same (preset, input) share a single in-flight
// detection promise. This prevents the earlier single-slot cache race where
// two interleaved calls could commit results bound to the wrong input.
const detectionCache = new Map<string, Promise<PatternMatch[]>>();
const DETECTION_CACHE_MAX = 128;

export async function detectWithOpenRedaction(
  input: string,
  opts?: BridgeOptions,
): Promise<PatternMatch[]> {
  // Presets are lower-case in our lookup tables. YAML configs often use
  // uppercase (HIPAA, PCI-DSS). normalize here so the case doesn't silently
  // no-op the preset-aware filter.
  const preset = (opts?.preset ?? '').toLowerCase();
  const key = `${preset}\u0000${input}`;

  const pending = detectionCache.get(key);
  if (pending) return pending;

  const run = (async () => {
    const detector = getDetector(opts?.preset);
    const result = await detector.detect(input);

    const mapped = result.detections.map((d) => ({
      type: normalizeType(d.type),
      match: d.value,
      offset: d.position[0],
      length: d.position[1] - d.position[0],
    }));
    const filters = opts?.filters ?? DEFAULT_OR_FILTERS;
    return runFilters(filters, mapped, { preset });
  })();

  if (detectionCache.size >= DETECTION_CACHE_MAX) {
    // oldest-first eviction; Map iteration is insertion-ordered
    const oldest = detectionCache.keys().next().value;
    if (oldest !== undefined) detectionCache.delete(oldest);
  }
  detectionCache.set(key, run);
  return run;
}

const TYPE_MAP: Record<string, string> = {
  EMAIL: 'email',
  CREDIT_CARD: 'credit-card',
  IBAN: 'iban',
  PHONE_UK_MOBILE: 'phone',
  PHONE_UK: 'phone',
  PHONE_US: 'phone',
  PHONE_INTERNATIONAL: 'phone',
  PHONE_LINE_NUMBER: 'phone',
  IPV4: 'ipv4',
  IPV6: 'ipv6',
  MAC_ADDRESS: 'mac',
  AWS_ACCESS_KEY: 'aws-access-key',
  AWS_SECRET_KEY: 'aws-secret-key',
  GITHUB_TOKEN: 'github-token',
  NPM_TOKEN: 'npm-token',
  JWT_TOKEN: 'jwt',
  BEARER_TOKEN: 'bearer-token',
  PRIVATE_KEY: 'private-key',
  SSH_PRIVATE_KEY: 'private-key',
  DATABASE_CONNECTION: 'connection-string',
  GENERIC_SECRET: 'generic-secret',
  GENERIC_API_KEY: 'generic-secret',
  DATE_OF_BIRTH: 'date-of-birth',
  ADDRESS_STREET: 'address',
  ADDRESS_PO_BOX: 'address',
  POSTCODE_UK: 'address',
  GERMAN_TAX_ID: 'tax-id',
  NAME: 'person-name',
};

function normalizeType(orType: string): string {
  return TYPE_MAP[orType] ?? orType.toLowerCase().replace(/_/g, '-');
}
