import { describe, it, expect } from 'vitest';
import { validateRawConfig, hasErrors } from '../../src/config/validate.js';

describe('config validation', () => {
  it('accepts a minimal valid config', () => {
    const issues = validateRawConfig({
      version: 1,
      behavior: { port: 8100 },
      code: { language: 'typescript', domain_terms: [] },
    });
    expect(hasErrors(issues)).toBe(false);
  });

  it('rejects a port outside 1-65535', () => {
    const issues = validateRawConfig({ behavior: { port: 99999 } });
    const err = issues.find((i) => i.path === 'behavior.port');
    expect(err?.severity).toBe('error');
  });

  it('rejects a non-http upstream URL', () => {
    const issues = validateRawConfig({
      behavior: { upstream: { anthropic: 'ftp://evil.example' } },
    });
    expect(hasErrors(issues)).toBe(true);
  });

  it('warns about unknown top-level fields', () => {
    const issues = validateRawConfig({ totally_unknown: 'x' });
    const warn = issues.find((i) => i.path === 'totally_unknown');
    expect(warn?.severity).toBe('warning');
  });

  it('rejects non-array code.domain_terms', () => {
    const issues = validateRawConfig({ code: { domain_terms: 'CustomerOrder' } });
    expect(hasErrors(issues)).toBe(true);
  });

  it('rejects secrets.patterns without regex field', () => {
    const issues = validateRawConfig({
      secrets: { patterns: [{ name: 'broken' }] },
    });
    expect(hasErrors(issues)).toBe(true);
  });

  it('accepts a 16+ char behavior.mgmt_token', () => {
    const issues = validateRawConfig({
      behavior: { mgmt_token: 'abcdefghijklmnop' },
    });
    expect(hasErrors(issues)).toBe(false);
  });

  it('rejects a too-short behavior.mgmt_token', () => {
    const issues = validateRawConfig({
      behavior: { mgmt_token: 'tooshort' },
    });
    const err = issues.find((i) => i.path === 'behavior.mgmt_token');
    expect(err?.severity).toBe('error');
  });

  it('rejects a non-string behavior.mgmt_token', () => {
    const issues = validateRawConfig({
      behavior: { mgmt_token: 123 },
    });
    const err = issues.find((i) => i.path === 'behavior.mgmt_token');
    expect(err?.severity).toBe('error');
  });
});
