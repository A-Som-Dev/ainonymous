import { describe, it, expect } from 'vitest';
import { validateRawConfig, hasErrors } from '../../src/config/validate.js';

describe('config validator cycle detection', () => {
  it('flags a direct self-reference as error', () => {
    const raw: Record<string, unknown> = { behavior: {} };
    raw.self = raw;
    const issues = validateRawConfig(raw);
    expect(hasErrors(issues)).toBe(true);
    expect(issues.some((i) => i.message.includes('self-reference'))).toBe(true);
  });

  it('flags an indirect cycle through nested object', () => {
    const inner: Record<string, unknown> = {};
    const raw: Record<string, unknown> = { behavior: { nested: inner } };
    inner.back = raw;
    const issues = validateRawConfig(raw);
    expect(hasErrors(issues)).toBe(true);
  });

  it('accepts a DAG (same value referenced from two siblings, no cycle)', () => {
    const shared = { port: 8100 };
    const raw: Record<string, unknown> = {
      behavior: { ...shared },
      session: { persist: false },
    };
    const issues = validateRawConfig(raw);
    expect(hasErrors(issues)).toBe(false);
  });
});
