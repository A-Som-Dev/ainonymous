import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type {
  AInonymousConfig,
  CodeConfig,
  BehaviorConfig,
  UpstreamConfig,
  SessionConfig,
} from '../types.js';
import { DEFAULT_CONFIG } from './schema.js';
import { autoDetect } from './auto-detect.js';
import { validateRawConfig, hasErrors, describeUntrustedHost } from './validate.js';
import { log } from '../logger.js';

const CONFIG_FILENAME = '.ainonymous.yml';
const LEGACY_CONFIG_FILENAME = '.ainonymity.yml';

export function getDefaults(): AInonymousConfig {
  return structuredClone(DEFAULT_CONFIG);
}

export function loadConfig(projectDir: string): AInonymousConfig {
  const defaults = getDefaults();
  const configPath = join(projectDir, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    const legacyPath = join(projectDir, LEGACY_CONFIG_FILENAME);
    if (existsSync(legacyPath)) {
      log.warn('legacy config filename detected and ignored, rename to .ainonymous.yml', {
        legacy: legacyPath,
      });
    }
    return autoDetect(projectDir);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(raw) as Record<string, unknown> | null;

  if (!parsed || typeof parsed !== 'object') {
    return defaults;
  }

  const issues = validateRawConfig(parsed);
  for (const issue of issues) {
    if (issue.severity === 'error') {
      log.error('invalid config', { path: issue.path, reason: issue.message });
    } else {
      log.warn('config field ignored', { path: issue.path, reason: issue.message });
    }
  }
  if (hasErrors(issues)) {
    throw new Error(`${CONFIG_FILENAME} has validation errors; see logs above`);
  }

  return mergeConfig(defaults, parsed);
}

function mergeConfig(defaults: AInonymousConfig, raw: Record<string, unknown>): AInonymousConfig {
  const cfg = structuredClone(defaults);

  if (typeof raw.version === 'number') {
    cfg.version = raw.version;
  }

  if (isObj(raw.secrets)) {
    const s = raw.secrets as Record<string, unknown>;
    if (Array.isArray(s.patterns)) {
      cfg.secrets.patterns = s.patterns.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? ''),
        regex: String(p.regex ?? ''),
      }));
    }
  }

  if (isObj(raw.identity)) {
    const id = raw.identity as Record<string, unknown>;
    if (typeof id.company === 'string') cfg.identity.company = id.company;
    if (Array.isArray(id.domains)) cfg.identity.domains = id.domains.map(String);
    if (Array.isArray(id.people)) cfg.identity.people = id.people.map(String);
  }

  if (isObj(raw.code)) {
    cfg.code = mapCodeConfig(defaults.code, raw.code as Record<string, unknown>);
  }

  if (isObj(raw.behavior)) {
    cfg.behavior = mapBehaviorConfig(defaults.behavior, raw.behavior as Record<string, unknown>);
  }

  if (isObj(raw.session)) {
    cfg.session = mapSessionConfig(defaults.session, raw.session as Record<string, unknown>);
  }

  if (isObj(raw.filters)) {
    const f = raw.filters as Record<string, unknown>;
    const pins: Record<string, string> = {};
    if (isObj(f.custom_pins)) {
      for (const [k, v] of Object.entries(f.custom_pins as Record<string, unknown>)) {
        if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) {
          pins[k] = v;
        } else {
          log.warn('filters.custom_pins entry dropped (must be 64-char hex sha256)', {
            file: k,
          });
        }
      }
    }
    cfg.filters = {
      disable: Array.isArray(f.disable) ? f.disable.map(String) : [],
      custom: Array.isArray(f.custom) ? f.custom.map(String) : [],
      customPins: Object.keys(pins).length > 0 ? pins : undefined,
    };
  }

  if (isObj(raw.trust)) {
    const t = raw.trust as Record<string, unknown>;
    cfg.trust = {
      allowUnsignedLocal: t.allow_unsigned_local === true,
    };
  }

  if (isObj(raw.detectors)) {
    const d = raw.detectors as Record<string, unknown>;
    const pins: Record<string, string> = {};
    if (isObj(d.custom_pins)) {
      for (const [k, v] of Object.entries(d.custom_pins as Record<string, unknown>)) {
        if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) {
          pins[k] = v;
        } else {
          log.warn('detectors.custom_pins entry dropped (must be 64-char hex sha256)', {
            file: k,
          });
        }
      }
    }
    cfg.detectors = {
      disable: Array.isArray(d.disable) ? d.disable.map(String) : [],
      custom: Array.isArray(d.custom) ? d.custom.map(String) : [],
      customPins: Object.keys(pins).length > 0 ? pins : undefined,
    };
  }

  return cfg;
}

function mapSessionConfig(defaults: SessionConfig, raw: Record<string, unknown>): SessionConfig {
  return {
    persist: typeof raw.persist === 'boolean' ? raw.persist : defaults.persist,
    persistPath: typeof raw.persist_path === 'string' ? raw.persist_path : defaults.persistPath,
  };
}

function mapCodeConfig(defaults: CodeConfig, raw: Record<string, unknown>): CodeConfig {
  return {
    language: typeof raw.language === 'string' ? raw.language : defaults.language,
    domainTerms: strArray(raw.domain_terms) ?? defaults.domainTerms,
    preserve: strArray(raw.preserve) ?? defaults.preserve,
    sensitivePaths: strArray(raw.sensitive_paths) ?? defaults.sensitivePaths,
    redactBodies: strArray(raw.redact_bodies) ?? defaults.redactBodies,
  };
}

function mapBehaviorConfig(defaults: BehaviorConfig, raw: Record<string, unknown>): BehaviorConfig {
  let upstream = defaults.upstream;
  if (isObj(raw.upstream)) {
    upstream = mapUpstreamConfig(defaults.upstream, raw.upstream as Record<string, unknown>);
  }

  const envAnthropic = process.env['AINONYMOUS_UPSTREAM_ANTHROPIC'];
  const envOpenai = process.env['AINONYMOUS_UPSTREAM_OPENAI'];
  if (envAnthropic || envOpenai) {
    // Env override still has to pass the same https + host checks as the
    // yaml path. otherwise a malicious wrapper script could simply export
    // AINONYMOUS_UPSTREAM_ANTHROPIC=http://evil.com and siphon the API key.
    if (envAnthropic) {
      if (!/^https:\/\//.test(envAnthropic)) {
        throw new Error(
          'AINONYMOUS_UPSTREAM_ANTHROPIC must start with https://. plain http would send the API key in the clear',
        );
      }
      const hostIssue = describeUntrustedHost(envAnthropic, 'anthropic');
      if (hostIssue) {
        throw new Error(`AINONYMOUS_UPSTREAM_ANTHROPIC rejected: ${hostIssue}`);
      }
    }
    if (envOpenai) {
      if (!/^https:\/\//.test(envOpenai)) {
        throw new Error(
          'AINONYMOUS_UPSTREAM_OPENAI must start with https://. plain http would send the API key in the clear',
        );
      }
      const hostIssue = describeUntrustedHost(envOpenai, 'openai');
      if (hostIssue) {
        throw new Error(`AINONYMOUS_UPSTREAM_OPENAI rejected: ${hostIssue}`);
      }
    }
    upstream = {
      anthropic: envAnthropic ?? upstream.anthropic,
      openai: envOpenai ?? upstream.openai,
    };
  }

  const aggression =
    raw.aggression === 'low' || raw.aggression === 'medium' || raw.aggression === 'high'
      ? raw.aggression
      : defaults.aggression;

  const compliance = typeof raw.compliance === 'string' ? raw.compliance : defaults.compliance;
  const STRICT_PRESETS = new Set(['gdpr', 'hipaa', 'pci-dss']);
  const auditFailureDefault =
    compliance && STRICT_PRESETS.has(compliance) ? 'block' : defaults.auditFailure;
  const auditFailure =
    raw.audit_failure === 'block' || raw.audit_failure === 'permit'
      ? raw.audit_failure
      : auditFailureDefault;

  return {
    interactive: typeof raw.interactive === 'boolean' ? raw.interactive : defaults.interactive,
    auditLog: typeof raw.audit_log === 'boolean' ? raw.audit_log : defaults.auditLog,
    auditDir: typeof raw.audit_dir === 'string' ? raw.audit_dir : defaults.auditDir,
    dashboard: typeof raw.dashboard === 'boolean' ? raw.dashboard : defaults.dashboard,
    port: typeof raw.port === 'number' ? raw.port : defaults.port,
    compliance,
    upstream,
    mgmtToken: typeof raw.mgmt_token === 'string' ? raw.mgmt_token : defaults.mgmtToken,
    aggression,
    auditFailure,
    oauthPassthrough:
      typeof raw.oauth_passthrough === 'boolean'
        ? raw.oauth_passthrough
        : defaults.oauthPassthrough,
    streaming: mapStreamingConfig(defaults.streaming, raw.streaming),
  };
}

function mapStreamingConfig(
  defaults: { eagerFlush?: boolean } | undefined,
  raw: unknown,
): { eagerFlush: boolean } {
  const base = { eagerFlush: defaults?.eagerFlush === true };
  if (!isObj(raw)) return base;
  if (typeof (raw as { eager_flush?: unknown }).eager_flush === 'boolean') {
    base.eagerFlush = (raw as { eager_flush: boolean }).eager_flush;
  }
  return base;
}

function mapUpstreamConfig(defaults: UpstreamConfig, raw: Record<string, unknown>): UpstreamConfig {
  return {
    anthropic: typeof raw.anthropic === 'string' ? raw.anthropic : defaults.anthropic,
    openai: typeof raw.openai === 'string' ? raw.openai : defaults.openai,
  };
}

function strArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  return val.map(String);
}

function isObj(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}
