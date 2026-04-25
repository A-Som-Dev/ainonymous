import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'index.js');

describe('ainonymous preview', () => {
  let workdir: string;

  beforeAll(() => {
    execSync('npx tsc', { cwd: process.cwd(), stdio: 'ignore' });
  }, 60_000);

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-preview-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('reads a file and emits anonymised text plus a finding summary', () => {
    const input = join(workdir, 'input.txt');
    writeFileSync(
      input,
      'Contact support@acme-corp.example to reach the AcmeCorp operations team.',
      'utf-8',
    );
    writeFileSync(
      join(workdir, '.ainonymous.yml'),
      `identity:\n  company: AcmeCorp\n  domains: [acme-corp.example]\n  people: []\n`,
      'utf-8',
    );
    const out = execSync(`node "${cliPath}" preview --input-file "${input}"`, {
      cwd: workdir,
      encoding: 'utf-8',
    });
    expect(out).not.toContain('acme-corp.example');
    expect(out).not.toContain('AcmeCorp');
  });

  it('emits JSON with --json', () => {
    const input = join(workdir, 'input.txt');
    writeFileSync(input, 'email: foo@bar.example', 'utf-8');
    writeFileSync(
      join(workdir, '.ainonymous.yml'),
      `identity:\n  company: ''\n  domains: [bar.example]\n  people: []\n`,
      'utf-8',
    );
    const out = execSync(`node "${cliPath}" preview --input-file "${input}" --json`, {
      cwd: workdir,
      encoding: 'utf-8',
    });
    const json = JSON.parse(out) as { text: string; replacements: unknown[] };
    expect(typeof json.text).toBe('string');
    expect(Array.isArray(json.replacements)).toBe(true);
  });
});
