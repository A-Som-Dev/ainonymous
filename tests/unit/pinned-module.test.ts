import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  loadPinnedModuleSource,
  PinnedModuleMissingError,
  PinnedModulePinFormatError,
} from '../../src/util/pinned-module.js';

describe('loadPinnedModuleSource', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-pinned-mod-'));
  });

  afterEach(() => {
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  function writeFile(name: string, content: string): string {
    const abs = join(workdir, name);
    writeFileSync(abs, content);
    return abs;
  }

  function sha(content: string): string {
    return createHash('sha256').update(Buffer.from(content)).digest('hex');
  }

  it('throws PinnedModuleMissingError when the file does not exist', () => {
    expect(() =>
      loadPinnedModuleSource(join(workdir, 'nope.js'), undefined, () => {
        throw new Error('mismatch handler should not run');
      }),
    ).toThrow(PinnedModuleMissingError);
  });

  it('returns a data URL when no pin is configured', () => {
    const abs = writeFile('mod.js', 'export default 1;');
    const result = loadPinnedModuleSource(abs, undefined, () => {
      throw new Error('mismatch handler should not run');
    });
    expect(result.dataUrl.startsWith('data:text/javascript;base64,')).toBe(true);
    expect(result.dataUrl).toContain(encodeURIComponent(abs));
  });

  it('rejects a malformed (non-hex64) pin via PinnedModulePinFormatError', () => {
    const abs = writeFile('mod.js', 'export default 1;');
    expect(() =>
      loadPinnedModuleSource(abs, 'not-a-real-hash', () => {
        throw new Error('mismatch handler should not run');
      }),
    ).toThrow(PinnedModulePinFormatError);
  });

  it('rejects an uppercase non-hex pin (any character outside 0-9a-f)', () => {
    const abs = writeFile('mod.js', 'export default 1;');
    expect(() =>
      loadPinnedModuleSource(abs, 'g'.repeat(64), () => {
        throw new Error('mismatch handler should not run');
      }),
    ).toThrow(PinnedModulePinFormatError);
  });

  it('routes a sha256 mismatch through the caller-supplied onPinMismatch hook', () => {
    const abs = writeFile('mod.js', 'export default 1;');
    const wrongPin = '0'.repeat(64);
    expect(() =>
      loadPinnedModuleSource(abs, wrongPin, (path, expected, actual) => {
        throw new Error(`custom mismatch: ${path} expected ${expected} got ${actual}`);
      }),
    ).toThrow(/custom mismatch.*expected 0+/);
  });

  it('returns the dataUrl when pin matches', () => {
    const content = 'export default {a: 1};';
    const abs = writeFile('mod.js', content);
    const goodPin = sha(content);
    const result = loadPinnedModuleSource(abs, goodPin, () => {
      throw new Error('mismatch handler should not run');
    });
    expect(result.bytes.toString('utf-8')).toBe(content);
  });

  it('accepts uppercase pin letters by case-folding to lower', () => {
    const content = 'export default {a: 1};';
    const abs = writeFile('mod.js', content);
    const goodPin = sha(content).toUpperCase();
    expect(() =>
      loadPinnedModuleSource(abs, goodPin, () => {
        throw new Error('mismatch handler should not run');
      }),
    ).not.toThrow();
  });
});
