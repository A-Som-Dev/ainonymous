import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CI secret-scan fallback job', () => {
  const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf-8');

  it('defines a secret-scan job', () => {
    expect(ci).toMatch(/secret-scan:/);
  });

  it('invokes the scan-diff-for-secrets script', () => {
    expect(ci).toMatch(/scan-diff-for-secrets\.mjs/);
  });

  it('handles both pull_request and push events', () => {
    expect(ci).toMatch(/pull_request/);
    expect(ci).toMatch(/--tree/);
  });
});
