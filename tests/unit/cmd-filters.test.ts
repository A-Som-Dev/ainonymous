import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'index.js');

describe('ainonymous filters CLI', () => {
  let workdir: string;

  beforeAll(() => {
    execSync('npx tsc', { cwd: process.cwd(), stdio: 'ignore' });
  }, 120_000);

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-filters-cli-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('filters list prints built-in filter ids', () => {
    const out = execSync(`node "${cliPath}" filters list`, {
      cwd: workdir,
      encoding: 'utf-8',
    });
    expect(out).toMatch(/always-disabled/);
    expect(out).toMatch(/country-ids/);
    expect(out).toMatch(/credit-card-preset/);
  });

  it('filters list honors filters.disable from .ainonymous.yml', () => {
    writeFileSync(
      join(workdir, '.ainonymous.yml'),
      `filters:\n  disable:\n    - always-disabled\n`,
      'utf-8',
    );
    const out = execSync(`node "${cliPath}" filters list`, {
      cwd: workdir,
      encoding: 'utf-8',
    });
    expect(out).toMatch(/disabled.*always-disabled/i);
  });

  it('filters validate accepts a well-formed custom filter', () => {
    const p = join(workdir, 'good.mjs');
    writeFileSync(
      p,
      `export default { id: 'sample-filter', description: 'sample', accept: () => true };`,
      'utf-8',
    );
    const out = execSync(`node "${cliPath}" filters validate "${p}"`, {
      cwd: workdir,
      encoding: 'utf-8',
    });
    expect(out).toMatch(/ok sample-filter/);
  });

  it('filters validate exits non-zero on a broken filter', () => {
    const p = join(workdir, 'broken.mjs');
    writeFileSync(p, `export default { accept: () => true };`, 'utf-8');
    try {
      execSync(`node "${cliPath}" filters validate "${p}"`, {
        cwd: workdir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      throw new Error('expected non-zero exit');
    } catch (err) {
      expect((err as { status?: number }).status).not.toBe(0);
    }
  });
});
