import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

describe('audit verify CLI help text', () => {
  const cliPath = join(process.cwd(), 'dist', 'cli', 'index.js');

  it('clarifies that verify is chain-consistency, not tamper-evidence', () => {
    const out = execSync(`node "${cliPath}" audit verify --help`, {
      encoding: 'utf-8',
      env: process.env,
    });
    expect(out).toMatch(/chain[- ]consistency/i);
    expect(out).toMatch(/tamper/i);
  });
});
