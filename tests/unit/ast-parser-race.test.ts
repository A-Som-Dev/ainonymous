import { describe, it, expect, beforeAll } from 'vitest';
import { extractIdentifiers, initParser } from '../../src/ast/extractor.js';
import { getParser, __parserCacheSize } from '../../src/ast/parser.js';

const JAVA_A = `public class InvoiceProcessor { public void run() {} }`;
const JAVA_B = `public class PaymentGateway { public void charge() {} }`;
const PY_A = `class InvoiceService:\n    def generate(self, order):\n        pass`;
const PY_B = `def compute_total(items):\n    return sum(items)`;
const GO_A = `package main\nfunc ProcessOrder() {}`;
const RUST_A = `fn process_order(id: u32) -> Result<(), String> { Ok(()) }`;

describe('parser cache is per-language', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('stores one parser per distinct language', async () => {
    const sizeBefore = __parserCacheSize();

    await getParser('java');
    await getParser('java');
    await getParser('python');

    const sizeAfter = __parserCacheSize();
    expect(sizeAfter - sizeBefore).toBeGreaterThanOrEqual(2);
  });

  it('returns the same parser instance for repeated calls with same lang', async () => {
    const p1 = await getParser('java');
    const p2 = await getParser('java');
    expect(p1).toBe(p2);
  });

  it('returns different parser instances for different langs', async () => {
    const javaParser = await getParser('java');
    const pythonParser = await getParser('python');
    expect(javaParser).not.toBe(pythonParser);
  });
});

describe('concurrent mixed-language extraction', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('interleaved java/python calls stay correct', async () => {
    const results = await Promise.all([
      extractIdentifiers(JAVA_A, 'java'),
      extractIdentifiers(PY_A, 'python'),
      extractIdentifiers(JAVA_B, 'java'),
      extractIdentifiers(PY_B, 'python'),
    ]);

    const [javaA, pyA, javaB, pyB] = results.map((ids) => ids.map((i) => i.name));

    expect(javaA).toContain('InvoiceProcessor');
    expect(pyA).toContain('InvoiceService');
    expect(pyA).toContain('generate');
    expect(javaB).toContain('PaymentGateway');
    expect(pyB).toContain('compute_total');

    // cross-contamination check: Java names must not leak into Python results
    expect(pyA).not.toContain('InvoiceProcessor');
    expect(pyA).not.toContain('PaymentGateway');
    expect(pyB).not.toContain('InvoiceProcessor');
    expect(javaA).not.toContain('InvoiceService');
    expect(javaA).not.toContain('compute_total');
  });

  it('stress: 4 langs x 5 repetitions concurrent', async () => {
    const calls: Array<Promise<{ expected: string; got: string[] }>> = [];
    for (let i = 0; i < 5; i++) {
      calls.push(
        extractIdentifiers(JAVA_A, 'java').then((ids) => ({
          expected: 'InvoiceProcessor',
          got: ids.map((x) => x.name),
        })),
      );
      calls.push(
        extractIdentifiers(PY_A, 'python').then((ids) => ({
          expected: 'InvoiceService',
          got: ids.map((x) => x.name),
        })),
      );
      calls.push(
        extractIdentifiers(GO_A, 'go').then((ids) => ({
          expected: 'ProcessOrder',
          got: ids.map((x) => x.name),
        })),
      );
      calls.push(
        extractIdentifiers(RUST_A, 'rust').then((ids) => ({
          expected: 'process_order',
          got: ids.map((x) => x.name),
        })),
      );
    }

    const results = await Promise.all(calls);
    for (const r of results) {
      expect(r.got).toContain(r.expected);
    }
  });

  it('concurrent same-language calls return correct results', async () => {
    const results = await Promise.all([
      extractIdentifiers(JAVA_A, 'java'),
      extractIdentifiers(JAVA_B, 'java'),
      extractIdentifiers(JAVA_A, 'java'),
      extractIdentifiers(JAVA_B, 'java'),
      extractIdentifiers(JAVA_A, 'java'),
    ]);
    const names = results.map((ids) => ids.map((i) => i.name));
    expect(names[0]).toContain('InvoiceProcessor');
    expect(names[1]).toContain('PaymentGateway');
    expect(names[2]).toContain('InvoiceProcessor');
    expect(names[3]).toContain('PaymentGateway');
    expect(names[4]).toContain('InvoiceProcessor');
  });
});
