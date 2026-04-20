import { describe, it, expect } from 'vitest';
import { validateRawConfig, hasErrors } from '../../src/config/validate.js';

describe('config validation: compliance requires audit_log', () => {
  it('rejects gdpr + audit_log: false', () => {
    const issues = validateRawConfig({
      behavior: { compliance: 'gdpr', audit_log: false },
    });
    const err = issues.find((i) => i.severity === 'error' && /audit_log/.test(i.path + i.message));
    expect(err, `expected error about audit_log, got ${JSON.stringify(issues)}`).toBeDefined();
    expect(hasErrors(issues)).toBe(true);
  });

  it('rejects hipaa + audit_log: false', () => {
    const issues = validateRawConfig({
      behavior: { compliance: 'hipaa', audit_log: false },
    });
    expect(hasErrors(issues)).toBe(true);
  });

  it('rejects pci-dss + audit_log: false', () => {
    const issues = validateRawConfig({
      behavior: { compliance: 'pci-dss', audit_log: false },
    });
    expect(hasErrors(issues)).toBe(true);
  });

  it('accepts gdpr + audit_log: true', () => {
    const issues = validateRawConfig({
      behavior: { compliance: 'gdpr', audit_log: true },
    });
    expect(hasErrors(issues)).toBe(false);
  });

  it('accepts ccpa + audit_log: false (ccpa does not mandate)', () => {
    const issues = validateRawConfig({
      behavior: { compliance: 'ccpa', audit_log: false },
    });
    expect(hasErrors(issues)).toBe(false);
  });

  it('accepts gdpr without audit_log key (default stays permissive)', () => {
    const issues = validateRawConfig({
      behavior: { compliance: 'gdpr' },
    });
    expect(hasErrors(issues)).toBe(false);
  });
});
