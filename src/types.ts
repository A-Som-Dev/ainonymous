export type LayerName = 'secrets' | 'identity' | 'code';

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
}

export interface AuditEntry {
  timestamp: number;
  layer: LayerName;
  type: string;
  originalHash: string;
  context: string;
  /** Monotonic sequence number, starts at 0 per logger instance. */
  seq?: number;
  /** SHA-256 of (prevHash + serialized current entry without prevHash). Empty string for seq=0. */
  prevHash?: string;
}
