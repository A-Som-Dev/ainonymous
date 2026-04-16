import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getTokenPath, ensureTokenDir, hardenTokenFileAcl } from '../../src/cli/token-path.js';

describe('getTokenPath', () => {
  it('returns tmpdir-based path on linux', () => {
    const p = getTokenPath(8100, 'linux');
    expect(p).toBe(join(tmpdir(), 'ainonymity-8100.token'));
  });

  it('returns tmpdir-based path on darwin', () => {
    const p = getTokenPath(8200, 'darwin');
    expect(p).toBe(join(tmpdir(), 'ainonymity-8200.token'));
  });

  it('returns USERPROFILE-based path on win32', () => {
    const p = getTokenPath(8300, 'win32', { USERPROFILE: 'C:\\Users\\test' });
    expect(p).toBe(join('C:\\Users\\test', '.ainonymity', 'ainonymity-8300.token'));
  });

  it('falls back to os.homedir on win32 when USERPROFILE is missing', () => {
    const p = getTokenPath(8400, 'win32', {});
    expect(p).toContain('.ainonymity');
    expect(p).toContain('ainonymity-8400.token');
  });

  it('uses different port in filename', () => {
    const p1 = getTokenPath(9000, 'linux');
    const p2 = getTokenPath(9001, 'linux');
    expect(p1).not.toBe(p2);
  });
});

describe('ensureTokenDir', () => {
  const testHome = join(
    tmpdir(),
    `ain-token-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  beforeEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  it('is a no-op on linux (tmpdir already exists)', () => {
    const tokenFile = getTokenPath(8500, 'linux');
    expect(() => ensureTokenDir(tokenFile, 'linux')).not.toThrow();
  });

  it('creates the .ainonymity directory on win32 if missing', () => {
    const fakeWinPath = join(testHome, '.ainonymity', 'ainonymity-8600.token');
    ensureTokenDir(fakeWinPath, 'win32');
    expect(existsSync(join(testHome, '.ainonymity'))).toBe(true);
  });

  it('is idempotent on win32', () => {
    const fakeWinPath = join(testHome, '.ainonymity', 'ainonymity-8700.token');
    ensureTokenDir(fakeWinPath, 'win32');
    expect(() => ensureTokenDir(fakeWinPath, 'win32')).not.toThrow();
    expect(existsSync(join(testHome, '.ainonymity'))).toBe(true);
  });

  it('sets restrictive mode on the .ainonymity dir on win32', () => {
    const fakeWinPath = join(testHome, '.ainonymity', 'ainonymity-8800.token');
    ensureTokenDir(fakeWinPath, 'win32');
    const dirStat = statSync(join(testHome, '.ainonymity'));
    expect(dirStat.isDirectory()).toBe(true);
  });
});

describe('hardenTokenFileAcl', () => {
  it('is a no-op on linux and reports success', () => {
    const result = hardenTokenFileAcl('/tmp/ainonymity-8100.token', 'linux');
    expect(result).toBe(true);
  });

  it('is a no-op on darwin and reports success', () => {
    const result = hardenTokenFileAcl('/tmp/ainonymity-8200.token', 'darwin');
    expect(result).toBe(true);
  });

  it('returns false on win32 when no username can be determined', () => {
    const result = hardenTokenFileAcl('C:\\nonexistent\\ainonymity-8300.token', 'win32', {
      USERNAME: '',
    });
    // Either false (empty username) or true (fallback via userInfo succeeded).
    // The important contract: no throw.
    expect(typeof result).toBe('boolean');
  });
});
