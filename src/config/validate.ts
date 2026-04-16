import type { AInonymityConfig } from '../types.js';

const KNOWN_TOP_KEYS = new Set(['version', 'secrets', 'identity', 'code', 'behavior', 'session']);
const KNOWN_BEHAVIOR_KEYS = new Set([
  'interactive',
  'audit_log',
  'audit_dir',
  'dashboard',
  'port',
  'compliance',
  'upstream',
  'mgmt_token',
]);
const KNOWN_CODE_KEYS = new Set([
  'language',
  'domain_terms',
  'preserve',
  'sensitive_paths',
  'redact_bodies',
]);
const KNOWN_IDENTITY_KEYS = new Set(['company', 'domains', 'people']);
const KNOWN_UPSTREAM_KEYS = new Set(['anthropic', 'openai']);
const KNOWN_SESSION_KEYS = new Set(['persist', 'persist_path']);

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export function validateRawConfig(raw: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      issues.push({ path: key, message: 'unknown top-level field (ignored)', severity: 'warning' });
    }
  }

  if (raw.behavior && typeof raw.behavior === 'object' && !Array.isArray(raw.behavior)) {
    const b = raw.behavior as Record<string, unknown>;

    for (const key of Object.keys(b)) {
      if (!KNOWN_BEHAVIOR_KEYS.has(key)) {
        issues.push({
          path: `behavior.${key}`,
          message: 'unknown field (ignored)',
          severity: 'warning',
        });
      }
    }

    if (b.port !== undefined) {
      if (typeof b.port !== 'number' || !Number.isInteger(b.port) || b.port < 1 || b.port > 65535) {
        issues.push({
          path: 'behavior.port',
          message: 'must be an integer between 1 and 65535',
          severity: 'error',
        });
      }
    }

    if (b.compliance !== undefined && typeof b.compliance !== 'string') {
      issues.push({ path: 'behavior.compliance', message: 'must be a string', severity: 'error' });
    }

    if (b.mgmt_token !== undefined) {
      if (typeof b.mgmt_token !== 'string') {
        issues.push({
          path: 'behavior.mgmt_token',
          message: 'must be a string',
          severity: 'error',
        });
      } else if (b.mgmt_token.length < 16) {
        issues.push({
          path: 'behavior.mgmt_token',
          message: 'must be at least 16 characters',
          severity: 'error',
        });
      }
    }

    if (b.upstream && typeof b.upstream === 'object' && !Array.isArray(b.upstream)) {
      const u = b.upstream as Record<string, unknown>;
      for (const key of Object.keys(u)) {
        if (!KNOWN_UPSTREAM_KEYS.has(key)) {
          issues.push({
            path: `behavior.upstream.${key}`,
            message: 'unknown field (ignored)',
            severity: 'warning',
          });
        }
      }
      for (const provider of ['anthropic', 'openai'] as const) {
        const v = u[provider];
        if (v !== undefined && (typeof v !== 'string' || !/^https?:\/\//.test(v))) {
          issues.push({
            path: `behavior.upstream.${provider}`,
            message: 'must be an http(s) URL',
            severity: 'error',
          });
        }
      }
    }
  }

  if (raw.code && typeof raw.code === 'object' && !Array.isArray(raw.code)) {
    const c = raw.code as Record<string, unknown>;
    for (const key of Object.keys(c)) {
      if (!KNOWN_CODE_KEYS.has(key)) {
        issues.push({
          path: `code.${key}`,
          message: 'unknown field (ignored)',
          severity: 'warning',
        });
      }
    }
    for (const field of ['domain_terms', 'preserve', 'sensitive_paths', 'redact_bodies'] as const) {
      if (c[field] !== undefined && !Array.isArray(c[field])) {
        issues.push({ path: `code.${field}`, message: 'must be an array', severity: 'error' });
      }
    }
  }

  if (raw.identity && typeof raw.identity === 'object' && !Array.isArray(raw.identity)) {
    const id = raw.identity as Record<string, unknown>;
    for (const key of Object.keys(id)) {
      if (!KNOWN_IDENTITY_KEYS.has(key)) {
        issues.push({
          path: `identity.${key}`,
          message: 'unknown field (ignored)',
          severity: 'warning',
        });
      }
    }
    for (const field of ['domains', 'people'] as const) {
      if (id[field] !== undefined && !Array.isArray(id[field])) {
        issues.push({ path: `identity.${field}`, message: 'must be an array', severity: 'error' });
      }
    }
  }

  if (raw.session && typeof raw.session === 'object' && !Array.isArray(raw.session)) {
    const s = raw.session as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      if (!KNOWN_SESSION_KEYS.has(key)) {
        issues.push({
          path: `session.${key}`,
          message: 'unknown field (ignored)',
          severity: 'warning',
        });
      }
    }
    if (s.persist !== undefined && typeof s.persist !== 'boolean') {
      issues.push({ path: 'session.persist', message: 'must be a boolean', severity: 'error' });
    }
    if (s.persist_path !== undefined && typeof s.persist_path !== 'string') {
      issues.push({ path: 'session.persist_path', message: 'must be a string', severity: 'error' });
    }
  }

  if (raw.secrets && typeof raw.secrets === 'object' && !Array.isArray(raw.secrets)) {
    const s = raw.secrets as Record<string, unknown>;
    if (s.patterns !== undefined) {
      if (!Array.isArray(s.patterns)) {
        issues.push({ path: 'secrets.patterns', message: 'must be an array', severity: 'error' });
      } else {
        for (let i = 0; i < s.patterns.length; i++) {
          const p = s.patterns[i];
          if (
            !p ||
            typeof p !== 'object' ||
            typeof (p as Record<string, unknown>).regex !== 'string'
          ) {
            issues.push({
              path: `secrets.patterns[${i}]`,
              message: 'must be { name, regex }',
              severity: 'error',
            });
          }
        }
      }
    }
  }

  return issues;
}

/** Types for consumers that want to check success without inspecting the issue list. */
export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export type { AInonymityConfig };
