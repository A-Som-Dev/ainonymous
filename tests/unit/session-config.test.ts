import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, getDefaults } from '../../src/config/loader.js';
import { validateRawConfig, hasErrors } from '../../src/config/validate.js';

describe('session config', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  function writeYaml(body: string): string {
    const d = mkdtempSync(join(tmpdir(), 'ain-sess-cfg-'));
    writeFileSync(join(d, '.ainonymity.yml'), body, 'utf-8');
    return d;
  }

  it('defaults persist to false and persistPath to undefined', () => {
    const cfg = getDefaults();
    expect(cfg.session.persist).toBe(false);
    expect(cfg.session.persistPath).toBeUndefined();
  });

  it('maps session.persist and session.persist_path from yaml', () => {
    dir = writeYaml('version: 1\nsession:\n  persist: true\n  persist_path: "./foo.db"\n');
    const cfg = loadConfig(dir);
    expect(cfg.session.persist).toBe(true);
    expect(cfg.session.persistPath).toBe('./foo.db');
  });

  it('accepts persist without persist_path', () => {
    dir = writeYaml('version: 1\nsession:\n  persist: true\n');
    const cfg = loadConfig(dir);
    expect(cfg.session.persist).toBe(true);
    expect(cfg.session.persistPath).toBeUndefined();
  });

  it('rejects non-boolean persist', () => {
    const issues = validateRawConfig({ session: { persist: 'yes' } });
    expect(hasErrors(issues)).toBe(true);
    expect(issues.some((i) => i.path === 'session.persist')).toBe(true);
  });

  it('rejects non-string persist_path', () => {
    const issues = validateRawConfig({ session: { persist: true, persist_path: 42 } });
    expect(hasErrors(issues)).toBe(true);
    expect(issues.some((i) => i.path === 'session.persist_path')).toBe(true);
  });

  it('warns on unknown session.* fields', () => {
    const issues = validateRawConfig({ session: { persist: true, foo: 'bar' } });
    const warn = issues.find((i) => i.path === 'session.foo');
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe('warning');
  });
});
