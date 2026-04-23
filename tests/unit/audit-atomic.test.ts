import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWriteFileSync } from '../../src/audit/atomic.js';

describe('atomicWriteFileSync', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-atomic-'));
  });

  afterEach(() => {
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {}
  });

  it('writes the requested bytes to the target path', () => {
    const path = join(workdir, 'file.json');
    atomicWriteFileSync(path, '{"hello":"world"}');
    expect(readFileSync(path, 'utf-8')).toBe('{"hello":"world"}');
  });

  it('overwrites an existing file in place', () => {
    const path = join(workdir, 'file.json');
    writeFileSync(path, 'OLD', 'utf-8');
    atomicWriteFileSync(path, 'NEW');
    expect(readFileSync(path, 'utf-8')).toBe('NEW');
  });

  it('leaves no .tmp.* files behind on success', () => {
    const path = join(workdir, 'file.json');
    atomicWriteFileSync(path, 'a');
    atomicWriteFileSync(path, 'b');
    atomicWriteFileSync(path, 'c');
    const stragglers = readdirSync(workdir).filter((f) => f.includes('.tmp.'));
    expect(stragglers).toEqual([]);
  });

  it('cleans up the tmp file and surfaces the error when rename fails (target is a directory)', () => {
    // renameSync(file, dir) fails on every platform with EISDIR/EPERM,
    // giving us a real OS-level rename failure without mocks.
    const target = join(workdir, 'target');
    mkdirSync(target);

    expect(() => atomicWriteFileSync(target, 'data')).toThrow();

    const stragglers = readdirSync(workdir).filter((f) => f.includes('.tmp.'));
    expect(stragglers).toEqual([]);
  });
});
