import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, getDefaults } from '../../src/config/loader.js';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('config loader', () => {
  it('auto-detects when no config file exists', () => {
    const cfg = loadConfig('/nonexistent/path');
    expect(cfg.version).toBe(1);
    expect(cfg.behavior.port).toBe(8100);
    // auto-detect extracts terms from directory name
    expect(cfg.code.domainTerms).toContain('Path');
    // no git repo → empty company
    expect(cfg.identity.company).toBe('');
  });

  it('falls back to auto-detect and still works if only legacy .ainonymity.yml exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ain-legacy-cfg-'));
    try {
      writeFileSync(
        join(tmp, '.ainonymity.yml'),
        'version: 1\nidentity:\n  company: LegacyCorp\n',
        'utf-8',
      );
      const cfg = loadConfig(tmp);
      // Legacy file is deliberately NOT loaded. user gets defaults, not LegacyCorp.
      expect(cfg.identity.company).not.toBe('LegacyCorp');
      expect(cfg.version).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('getDefaults returns clean defaults', () => {
    const cfg = getDefaults();
    expect(cfg.code.domainTerms).toEqual([]);
    expect(cfg.identity.company).toBe('');
  });

  it('loads yaml config from fixture', () => {
    const cfg = loadConfig(resolve(__dirname, '../fixtures'));
    expect(cfg.identity.company).toBe('Asom GmbH');
    expect(cfg.identity.domains).toContain('asom.de');
    expect(cfg.code.domainTerms).toContain('Customer');
    expect(cfg.secrets.patterns).toHaveLength(1);
    expect(cfg.secrets.patterns[0].name).toBe('internal-key');
  });

  it('merges partial config with defaults', () => {
    const cfg = loadConfig(resolve(__dirname, '../fixtures'));
    expect(cfg.behavior.interactive).toBe(true);
    expect(cfg.behavior.dashboard).toBe(true);
  });

  describe('behavior.mgmt_token', () => {
    let dir: string | null = null;

    afterEach(() => {
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
        dir = null;
      }
    });

    function writeYaml(body: string): string {
      const d = mkdtempSync(join(tmpdir(), 'ain-cfg-'));
      writeFileSync(join(d, '.ainonymous.yml'), body, 'utf-8');
      return d;
    }

    it('maps behavior.mgmt_token from yaml', () => {
      dir = writeYaml('version: 1\nbehavior:\n  mgmt_token: "abcdefghijklmnop"\n');
      const cfg = loadConfig(dir);
      expect(cfg.behavior.mgmtToken).toBe('abcdefghijklmnop');
    });

    it('defaults to undefined when not set', () => {
      dir = writeYaml('version: 1\nbehavior:\n  port: 8100\n');
      const cfg = loadConfig(dir);
      expect(cfg.behavior.mgmtToken).toBeUndefined();
    });
  });

  describe('duplicate-key detection', () => {
    let dir: string | null = null;

    afterEach(() => {
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
        dir = null;
      }
    });

    function writeYaml(body: string): string {
      const d = mkdtempSync(join(tmpdir(), 'ain-cfg-dup-'));
      writeFileSync(join(d, '.ainonymous.yml'), body, 'utf-8');
      return d;
    }

    it('refuses a config with duplicate top-level keys', () => {
      dir = writeYaml(
        'version: 1\ndetectors:\n  disable: ["a"]\ndetectors:\n  disable: ["b"]\n',
      );
      expect(() => loadConfig(dir!)).toThrow(/duplicate.*key|conflicting/i);
    });

    it('refuses a config with duplicate nested keys', () => {
      dir = writeYaml(
        'version: 1\nfilters:\n  custom: ["./a.mjs"]\n  custom: ["./b.mjs"]\n',
      );
      expect(() => loadConfig(dir!)).toThrow(/duplicate.*key|conflicting/i);
    });
  });
});
