// Public plugin contract. Stable from v1.3; the freeze and a standalone
// @ainonymous/plugin-api package are tracked for v2.0. Import via
// `import type { DetectorPlugin } from 'ainonymous/plugin-api'`.

export type DetectorCapability = 'secrets' | 'pii' | 'infra' | 'code';

export interface DetectionHit {
  /** Canonical type name, kebab-case (e.g. `email`, `api-key`, `person-name`). */
  type: string;
  /** Exact byte range into the input the hit covers. */
  offset: number;
  length: number;
  /** Raw matched string. Callers must not echo this upstream. */
  match: string;
  /** Optional confidence 0..1. Higher wins during overlap resolution. */
  confidence?: number;
}

export interface DetectorContext {
  /** Lower-cased compliance preset (gdpr, hipaa, pci-dss, ...) or ''. */
  preset: string;
  /** Aggression mode chosen in behavior.aggression. */
  aggression: 'low' | 'medium' | 'high';
}

export interface DetectorPlugin {
  /** Stable kebab-case unique identifier. */
  readonly id: string;
  /** SemVer of the plugin implementation. */
  readonly version: string;
  /** Which pipeline layers this plugin contributes to. */
  readonly capabilities: readonly DetectorCapability[];
  /** Human-readable description surfaced by `ainonymous detectors list`. */
  readonly description?: string;
  /** Synchronous detect path. Must be pure and side-effect free. */
  detect(input: string, ctx: DetectorContext): DetectionHit[] | Promise<DetectionHit[]>;
}

// Disallow doubled or trailing separators so ids look like npm-style names
// (`acme.scanner`, `org-foo_bar`) and not `a--b`/`a-`/`..a`. The leading
// alnum + max length 64 carry over from the hmac-kid grammar.
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9]|[._-](?=[a-z0-9])){0,63}$/;

/** Narrows an unknown module default-export into a DetectorPlugin at
 *  runtime. Throws with a concrete reason on shape mismatch.
 *
 *  Reads `id` exactly once and then redefines it as a non-writable,
 *  non-configurable property. A malicious plugin with a dynamic getter
 *  cannot return one value during validation and a different value when
 *  the registry wraps hits (`plugin:<id>:<type>`) or when the disable
 *  matcher parses the namespace. Without this freeze the getter could
 *  spoof `plugin:fake` past the strict pattern check at hit-time. */
export function assertDetectorPlugin(value: unknown): asserts value is DetectorPlugin {
  if (!value || typeof value !== 'object') {
    throw new Error('plugin module default-export must be an object');
  }
  const v = value as Record<string, unknown>;
  const idSnapshot = v.id;
  if (typeof idSnapshot !== 'string' || idSnapshot.length === 0) {
    throw new Error('plugin missing string id');
  }
  if (!PLUGIN_ID_PATTERN.test(idSnapshot)) {
    throw new Error(
      `plugin id ${JSON.stringify(idSnapshot)} must match ${PLUGIN_ID_PATTERN.source} (lower-case, no colons, 1-64 chars)`,
    );
  }
  Object.defineProperty(v, 'id', {
    value: idSnapshot,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  if (typeof v.version !== 'string') {
    throw new Error(`plugin ${idSnapshot} missing string version`);
  }
  if (!Array.isArray(v.capabilities)) {
    throw new Error(`plugin ${idSnapshot} missing capabilities array`);
  }
  if (typeof v.detect !== 'function') {
    throw new Error(`plugin ${idSnapshot} missing detect() function`);
  }
}
