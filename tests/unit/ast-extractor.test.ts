import { describe, it, expect, beforeAll } from 'vitest';
import { extractIdentifiers, extractTopLevelValues, initParser } from '../../src/ast/extractor.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE = resolve(__dirname, '../fixtures/sample-ts-code.ts');
const PRESERVE = ['PrismaClient', 'express', 'Promise', 'string'];

describe('AST identifier extraction', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('extracts class names', async () => {
    const code = readFileSync(FIXTURE, 'utf8');
    const ids = await extractIdentifiers(code, 'typescript');
    const names = ids.map((i) => i.name);
    expect(names).toContain('CustomerLoyaltyService');
  });

  it('extracts interface names', async () => {
    const code = readFileSync(FIXTURE, 'utf8');
    const ids = await extractIdentifiers(code, 'typescript');
    const names = ids.map((i) => i.name);
    expect(names).toContain('AsomCustomer');
  });

  it('extracts enum names', async () => {
    const code = readFileSync(FIXTURE, 'utf8');
    const ids = await extractIdentifiers(code, 'typescript');
    const names = ids.map((i) => i.name);
    expect(names).toContain('DiscountLevel');
  });

  it('extracts method names', async () => {
    const code = readFileSync(FIXTURE, 'utf8');
    const ids = await extractIdentifiers(code, 'typescript');
    const names = ids.map((i) => i.name);
    expect(names).toContain('calculateDiscountTier');
  });

  it('marks identifier types correctly', async () => {
    const code = readFileSync(FIXTURE, 'utf8');
    const ids = await extractIdentifiers(code, 'typescript');
    const cls = ids.find((i) => i.name === 'CustomerLoyaltyService');
    expect(cls?.kind).toBe('class');
  });

  it('does not extract preserved/framework identifiers', async () => {
    const code = readFileSync(FIXTURE, 'utf8');
    const ids = await extractIdentifiers(code, 'typescript', PRESERVE);
    const names = ids.map((i) => i.name);
    expect(names).not.toContain('PrismaClient');
    expect(names).not.toContain('express');
  });
});

describe('extractTopLevelValues', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('captures Python top-level assignment values', async () => {
    const code = 'SECRET = "abc"\nPORT = 8080\n';
    const values = await extractTopLevelValues(code, 'python');
    const slices = values.map((v) => code.slice(v.start, v.end));
    expect(slices).toContain('"abc"');
    expect(slices).toContain('8080');
  });

  it('captures TypeScript top-level const/let values', async () => {
    const code = 'const TOKEN = "xyz";\nlet retries = 3;';
    const values = await extractTopLevelValues(code, 'typescript');
    const slices = values.map((v) => code.slice(v.start, v.end));
    expect(slices).toContain('"xyz"');
    expect(slices).toContain('3');
  });

  it('ignores values inside functions', async () => {
    const code = 'function f() {\n  const inner = "hidden";\n}\n';
    const values = await extractTopLevelValues(code, 'typescript');
    const slices = values.map((v) => code.slice(v.start, v.end));
    expect(slices).not.toContain('"hidden"');
  });

  it('captures Kotlin top-level string property values', async () => {
    const code = 'const val KEY = "secret"\nval NAME = "alice"';
    const values = await extractTopLevelValues(code, 'kotlin');
    const concatenated = values.map((v) => code.slice(v.start, v.end)).join(' ');
    expect(concatenated).toContain('secret');
    expect(concatenated).toContain('alice');
  });

  it('returns empty array for unsupported languages', async () => {
    const code = 'SECRET = "x"';
    const values = await extractTopLevelValues(code, 'ruby');
    expect(values).toEqual([]);
  });
});
