import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { autoDetect } from '../../src/config/auto-detect.js';

describe('auto-detect alias discovery (T6)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ain-alias-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('picks up the project name from pyproject.toml', () => {
    writeFileSync(
      join(dir, 'pyproject.toml'),
      `[project]\nname = "acme-jobs"\nversion = "0.1.0"\n`,
      'utf-8',
    );
    const cfg = autoDetect(dir);
    expect(cfg.code.domainTerms).toContain('acme-jobs');
  });

  it('picks up the name from setup.py', () => {
    writeFileSync(
      join(dir, 'setup.py'),
      `from setuptools import setup\nsetup(name='payments-gateway', version='1.0')\n`,
      'utf-8',
    );
    const cfg = autoDetect(dir);
    expect(cfg.code.domainTerms.join(',').toLowerCase()).toMatch(/payments-gateway|payments/);
  });

  it('parses the README H1 line when present', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: '@acme/service', version: '0.0.1' }),
      'utf-8',
    );
    writeFileSync(
      join(dir, 'README.md'),
      `# jobs4sally internal tooling\n\nSome prose.\n`,
      'utf-8',
    );
    const cfg = autoDetect(dir);
    const lowered = cfg.code.domainTerms.map((t) => t.toLowerCase());
    expect(lowered).toContain('jobs4sally');
  });

  it('parses the git remote origin url for an alias', () => {
    execSync('git init -q', { cwd: dir });
    execSync('git remote add origin https://github.com/acme/billing-core.git', { cwd: dir });
    const cfg = autoDetect(dir);
    const flat = cfg.code.domainTerms.join(',').toLowerCase();
    expect(flat).toMatch(/billing-core|billing/);
  });

  it('deduplicates aliases across sources', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foo-bar' }), 'utf-8');
    writeFileSync(join(dir, 'README.md'), `# foo-bar\n`, 'utf-8');
    writeFileSync(join(dir, 'pyproject.toml'), `[project]\nname = "foo-bar"\n`, 'utf-8');
    const cfg = autoDetect(dir);
    const count = cfg.code.domainTerms.filter((t) => t === 'foo-bar').length;
    expect(count).toBe(1);
  });
});
