export type LayerName = 'secrets' | 'identity' | 'code';

/** Audit-log entries widen LayerName with 'rehydration' for post-response tracking.
 *  SessionMap.set() still uses LayerName - rehydration is a log-only concern. */
export type AuditLayer = LayerName | 'rehydration';

export interface Replacement {
  original: string;
  pseudonym: string;
  layer: LayerName;
  type: string;
  offset: number;
  length: number;
}

export interface AnonymizeResult {
  text: string;
  replacements: Replacement[];
}

export interface Layer {
  name: LayerName;
  /** Sync path for layers without async deps (Layer 1, 2). Used in unit tests. */
  process(text: string, ctx: PipelineContext): AnonymizeResult;
  processAsync(text: string, ctx: PipelineContext): Promise<AnonymizeResult>;
}

export interface PipelineContext {
  sessionMap: SessionMap;
  config: AInonymousConfig;
  filePath?: string;
  /** Effective or-filter chain, resolved once at pipeline construction from
   *  built-ins + config overrides + trusted custom filters. */
  orFilters?: readonly import('./patterns/or-filters/types.js').OrPostFilter[];
  /** Additional DetectorPlugins registered at pipeline construction. Layer 1
   *  and Layer 2 call these alongside the built-in detectors and merge the
   *  hits into the existing pipeline. */
  detectorRegistry?: import('./plugin-api/registry.js').DetectorRegistry;
  /** Built-in detector ids the operator has asked to be dropped. Hits from
   *  the core matchers are post-filtered by type. */
  disabledDetectorIds?: ReadonlySet<string>;
}

export interface SessionMap {
  set(original: string, pseudonym: string, layer: LayerName, type: string): void;
  getByOriginal(original: string): string | undefined;
  getByPseudonym(pseudonym: string): string | undefined;
  entries(): Iterable<[string, string]>;
  size: number;
  getMaxPseudonymLength(): number;
  clear(): void;
}

export interface AInonymousConfig {
  version: number;
  secrets: SecretsConfig;
  identity: IdentityConfig;
  code: CodeConfig;
  behavior: BehaviorConfig;
  session: SessionConfig;
  filters?: FiltersConfig;
  trust?: TrustConfig;
  detectors?: DetectorsConfig;
}

export interface SessionConfig {
  /** Persist the session map to disk so pseudonyms survive process restarts.
   *  Default false: memory-only, legacy behavior. */
  persist: boolean;
  /** Path to the SQLite database file. Relative paths resolve against the
   *  current working directory. Only consulted when persist is true. */
  persistPath?: string;
}

export interface SecretsConfig {
  patterns: PatternDef[];
}

export interface PatternDef {
  name: string;
  regex: string;
}

export interface IdentityConfig {
  company: string;
  domains: string[];
  people: string[];
}

export interface CodeConfig {
  language: string;
  domainTerms: string[];
  preserve: string[];
  /** Glob patterns for extra-aggressive anonymization. Only effective in scan mode (not proxy). */
  sensitivePaths: string[];
  /** Glob patterns for automatic function body redaction. Only effective in scan mode (not proxy). */
  redactBodies: string[];
}

export type ApiFormat = 'anthropic' | 'openai' | 'unknown';

export interface UpstreamConfig {
  anthropic: string;
  openai: string;
}

export type AggressionMode = 'low' | 'medium' | 'high';
export type AuditFailureMode = 'block' | 'permit';

export interface BehaviorConfig {
  interactive: boolean;
  auditLog: boolean;
  auditDir: string;
  dashboard: boolean;
  port: number;
  compliance?: string;
  upstream: UpstreamConfig;
  /** Bearer token required for management endpoints (/metrics, /dashboard, /events).
   *  Unset leaves them open for backwards-compat. Env AINONYMOUS_MGMT_TOKEN overrides this. */
  mgmtToken?: string;
  /** How aggressively the code layer pseudonymizes identifiers.
   *  - low: only explicit identity/domain_terms, no AST identifier pseudonymization
   *  - medium (default): low + compound identifiers that contain a domain_term substring
   *  - high: all AST identifiers not in preserve */
  aggression: AggressionMode;
  auditFailure: AuditFailureMode;
  /** Forward unknown paths (anything outside /v1/messages and /v1/chat/completions)
   *  to the upstream without touching the body. Required for OAuth-subscription
   *  clients (Claude Code Max-Plan, Cursor Pro) that hit refresh/organization
   *  endpoints alongside the chat routes. Default false because a passthrough
   *  path widens the scope of what a misconfigured client can leak. */
  oauthPassthrough?: boolean;
  streaming?: StreamingConfig;
}

export interface StreamingConfig {
  /** Release buffered deltas at sentence-like boundaries (newline, `. `) as
   *  soon as they appear, instead of waiting for the full sliding window to
   *  fill. Reduces pair-programming latency but accepts a small false-negative
   *  risk for pseudonyms that straddle a sentence boundary. Default false. */
  eagerFlush?: boolean;
}

export interface FiltersConfig {
  /** Ids of built-in or-filters to remove from the chain. */
  disable?: string[];
  /** File paths (relative to project root) that default-export an OrPostFilter
   *  or an array thereof. Loaded only when trust.allowUnsignedLocal is true. */
  custom?: string[];
  /** Optional lowercase-hex SHA-256 pins keyed by entries in `custom`. A
   *  pinned filter is rejected on content mismatch even with unsigned loads
   *  enabled, so a checked-in trusted filter cannot be silently swapped. */
  customPins?: Record<string, string>;
}

export interface TrustConfig {
  /** Opt-in acknowledgement that loading unsigned local .mjs filters is OK. */
  allowUnsignedLocal?: boolean;
}

export interface DetectorsConfig {
  /** Built-in detector ids to remove from Layer 1/Layer 2 runs. */
  disable?: string[];
  /** Project-local `.mjs` modules that default-export a DetectorPlugin.
   *  Subject to the same trust gate as custom or-filters. */
  custom?: string[];
  /** Optional SHA-256 pins keyed by custom path. */
  customPins?: Record<string, string>;
}

export interface AuditEntry {
  timestamp: number;
  layer: AuditLayer;
  type: string;
  originalHash: string;
  context: string;
  /** Monotonic sequence number, starts at 0 per logger instance. */
  seq?: number;
  /** SHA-256 of (prevHash + serialized current entry without prevHash). Empty string for seq=0. */
  prevHash?: string;
  /** Pseudonym was the blanket sentinel. The rehydrator cannot map it back,
   *  so the original is structurally invisible to audit pending diffing. */
  sentinel?: true;
}
