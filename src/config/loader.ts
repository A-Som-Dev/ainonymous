import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type {
  AInonymityConfig,
  CodeConfig,
  BehaviorConfig,
  UpstreamConfig,
  SessionConfig,
} from '../types.js';
import { DEFAULT_CONFIG } from './schema.js';
import { autoDetect } from './auto-detect.js';
import { validateRawConfig, hasErrors } from './validate.js';
import { log } from '../logger.js';

const CONFIG_FILENAME = '.ainonymity.yml';

export function getDefaults(): AInonymityConfig {
  return structuredClone(DEFAULT_CONFIG);
}

export function loadConfig(projectDir: string): AInonymityConfig {
  const defaults = getDefaults();
  const configPath = join(projectDir, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
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

function mergeConfig(defaults: AInonymityConfig, raw: Record<string, unknown>): AInonymityConfig {
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

  const envAnthropic = process.env['AINONYMITY_UPSTREAM_ANTHROPIC'];
  const envOpenai = process.env['AINONYMITY_UPSTREAM_OPENAI'];
  if (envAnthropic || envOpenai) {
    upstream = {
      anthropic: envAnthropic ?? upstream.anthropic,
      openai: envOpenai ?? upstream.openai,
    };
  }

  return {
    interactive: typeof raw.interactive === 'boolean' ? raw.interactive : defaults.interactive,
    auditLog: typeof raw.audit_log === 'boolean' ? raw.audit_log : defaults.auditLog,
    auditDir: typeof raw.audit_dir === 'string' ? raw.audit_dir : defaults.auditDir,
    dashboard: typeof raw.dashboard === 'boolean' ? raw.dashboard : defaults.dashboard,
    port: typeof raw.port === 'number' ? raw.port : defaults.port,
    compliance: typeof raw.compliance === 'string' ? raw.compliance : defaults.compliance,
    upstream,
    mgmtToken: typeof raw.mgmt_token === 'string' ? raw.mgmt_token : defaults.mgmtToken,
  };
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
