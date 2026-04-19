import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const cliPath = join(process.cwd(), 'dist/cli/index.js');

function runDoctor(dir: string, extra: string[] = []): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [cliPath, 'doctor', '--dir', dir, ...extra], {
      encoding: 'utf-8',
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? '', status: e.status ?? 1 };
  }
}

describe('doctor', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-doctor-'));
  });

  afterEach(() => {
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  it('warns when .ainonymous.yml is missing', () => {
    const { stdout } = runDoctor(workdir);
    expect(stdout).toContain('.ainonymous.yml');
    expect(stdout).toMatch(/missing/);
  });

  it('warns on empty identity coverage per field', () => {
    writeFileSync(
      join(workdir, '.ainonymous.yml'),
      'identity:\n  company: ""\n  domains: []\n  people: []\n',
      'utf-8',
    );
    const { stdout } = runDoctor(workdir);
    expect(stdout).toMatch(/identity\.company.*empty/);
    expect(stdout).toMatch(/identity\.domains.*empty/);
    expect(stdout).toMatch(/identity\.people.*empty/);
  });

  it('warns only for missing field when some are populated', () => {
    writeFileSync(
      join(workdir, '.ainonymous.yml'),
      'identity:\n  company: acme\n  domains:\n    - acme.de\n  people: []\n',
      'utf-8',
    );
    const { stdout } = runDoctor(workdir);
    expect(stdout).toMatch(/identity\.people.*empty/);
    expect(stdout).not.toMatch(/identity\.company.*empty/);
    expect(stdout).not.toMatch(/identity\.domains.*empty/);
  });

  it('exits 1 under --strict when there are warnings', () => {
    writeFileSync(
      join(workdir, '.ainonymous.yml'),
      'identity:\n  company: ""\n  domains: []\n  people: []\n',
      'utf-8',
    );
    const { status } = runDoctor(workdir, ['--strict']);
    expect(status).toBe(1);
  });

  it('passes with populated identity', () => {
    writeFileSync(
      join(workdir, '.ainonymous.yml'),
      'identity:\n  company: acme\n  domains:\n    - acme.de\n  people:\n    - Alice Example\n',
      'utf-8',
    );
    const { stdout } = runDoctor(workdir);
    expect(stdout).toMatch(/identity\.company.*acme/);
    expect(stdout).toMatch(/identity\.domains.*1 configured/);
    expect(stdout).toMatch(/identity\.people.*1 configured/);
  });
});
