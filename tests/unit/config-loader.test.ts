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
      writeFileSync(join(d, '.ainonymity.yml'), body, 'utf-8');
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
});
