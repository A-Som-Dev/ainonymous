import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkSkipDirs,
  checkAuditCheckpoint,
  checkLanguageOverride,
} from '../../src/cli/cmd-doctor.js';

describe('doctor invariant checks', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-doctor-'));
  });

  afterEach(() => {
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  describe('checkSkipDirs', () => {
    it('warns when a bare `venv/` directory is present without a dot prefix', () => {
      mkdirSync(join(workdir, 'venv'));
      const result = checkSkipDirs(workdir);
      expect(result.status).toBe('warn');
      expect(result.detail).toMatch(/venv/);
    });

    it('returns ok when no bare venv exists', () => {
      const result = checkSkipDirs(workdir);
      expect(result.status).toBe('ok');
    });

    it('returns ok when only `.venv/` (dot-prefixed) is present', () => {
      mkdirSync(join(workdir, '.venv'));
      const result = checkSkipDirs(workdir);
      expect(result.status).toBe('ok');
    });
  });

  describe('checkAuditCheckpoint', () => {
    it('returns ok when no .ainonymous.yml exists', () => {
      const result = checkAuditCheckpoint(workdir);
      expect(result.status).toBe('ok');
      expect(result.detail).toMatch(/no config/);
    });

    it('returns ok when audit persistence is not configured', () => {
      writeFileSync(join(workdir, '.ainonymous.yml'), 'identity: {}\n');
      const result = checkAuditCheckpoint(workdir);
      expect(result.status).toBe('ok');
      expect(result.detail).toMatch(/not configured/);
    });

    it('returns ok with path when persist_dir resolves to an existing directory', () => {
      mkdirSync(join(workdir, 'audit'));
      writeFileSync(join(workdir, '.ainonymous.yml'), 'audit:\n  persist_dir: ./audit\n');
      const result = checkAuditCheckpoint(workdir);
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('audit');
    });

    it('returns ok with not-yet-created when persist_dir is set but the dir does not exist', () => {
      writeFileSync(join(workdir, '.ainonymous.yml'), 'audit:\n  persist_dir: ./not-there\n');
      const result = checkAuditCheckpoint(workdir);
      expect(result.status).toBe('ok');
      expect(result.detail).toMatch(/not yet/);
    });

    it('warns when language=unknown but a source-marker file is present', () => {
      writeFileSync(join(workdir, '.ainonymous.yml'), 'code:\n  language: unknown\n');
      writeFileSync(join(workdir, 'package.json'), '{}');
      const result = checkLanguageOverride(workdir);
      expect(result.status).toBe('warn');
      expect(result.detail).toMatch(/package\.json/);
    });

    it('does not warn when language=unknown and no source markers exist', () => {
      writeFileSync(join(workdir, '.ainonymous.yml'), 'code:\n  language: unknown\n');
      const result = checkLanguageOverride(workdir);
      expect(result.status).toBe('ok');
    });

    it('does not warn when language is set to a real language', () => {
      writeFileSync(join(workdir, '.ainonymous.yml'), 'code:\n  language: typescript\n');
      const result = checkLanguageOverride(workdir);
      expect(result.status).toBe('ok');
    });

    it('warns when a checkpoint sidecar lags behind the jsonl tail', () => {
      const auditDir = join(workdir, 'audit');
      mkdirSync(auditDir);
      const jsonl = join(auditDir, 'ainonymous-audit-2026-04-27.jsonl');
      // jsonl tail at seq=5
      writeFileSync(
        jsonl,
        ['{"seq":0}', '{"seq":1}', '{"seq":2}', '{"seq":3}', '{"seq":4}', '{"seq":5}'].join('\n') +
          '\n',
      );
      // checkpoint claims seq=2 (rolled-back / stale)
      writeFileSync(
        jsonl + '.checkpoint',
        JSON.stringify({ lastSeq: 2, lastHash: 'a'.repeat(64) }),
      );
      writeFileSync(join(workdir, '.ainonymous.yml'), 'audit:\n  persist_dir: ./audit\n');

      const result = checkAuditCheckpoint(workdir);
      expect(result.status).toBe('warn');
      expect(result.detail).toMatch(/checkpoint behind jsonl tail/i);
    });
  });
});
