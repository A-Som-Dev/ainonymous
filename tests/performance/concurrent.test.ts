import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

describe('concurrent load', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
    pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'Asom GmbH', domains: ['asom.internal'], people: ['Artur Sommer'] },
      code: { ...getDefaults().code, domainTerms: ['Customer', 'Order'], preserve: ['Express'] },
    });

    const warmup = 'class CustomerService { password = "secret12345678"; }';
    for (let i = 0; i < 5; i++) await pipeline.anonymize(warmup);
  });

  it('handles 50 concurrent anonymize calls without errors', async () => {
    const payloads = Array.from(
      { length: 50 },
      (_, i) =>
        `class Customer${i}Service { password = "secret_${i}_1234567890"; endpoint = "https://api.asom.internal/v1/orders/${i}"; }`,
    );

    const start = performance.now();
    const results = await Promise.all(payloads.map((p) => pipeline.anonymize(p)));
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(50);
    for (const r of results) {
      expect(r.text).not.toContain('secret_');
      expect(r.text).not.toContain('asom.internal');
      expect(r.replacements.length).toBeGreaterThan(0);
    }

    const avgPerCall = elapsed / 50;
    console.log(
      `50 concurrent anonymize calls: ${elapsed.toFixed(0)}ms total, ${avgPerCall.toFixed(1)}ms avg/call`,
    );
    expect(elapsed).toBeLessThan(60000);
  }, 90000);

  it('maintains consistent pseudonyms across concurrent calls for the same input', async () => {
    const same = 'class CustomerService { email = "jane@asom.internal"; }';
    const results = await Promise.all(Array.from({ length: 20 }, () => pipeline.anonymize(same)));

    const firstText = results[0].text;
    for (const r of results) {
      expect(r.text).toBe(firstText);
    }
  });

  it('records distribution: p50 p95 p99 for concurrent workload', async () => {
    const N = 30;
    const samples: number[] = [];

    const payloads = Array.from(
      { length: N },
      (_, i) => `class Foo${i} { bar() { return fetch("https://api.asom.internal/x/${i}"); } }`,
    );

    await Promise.all(
      payloads.map(async (p) => {
        const t = performance.now();
        await pipeline.anonymize(p);
        samples.push(performance.now() - t);
      }),
    );

    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);

    console.log(
      `Concurrent latency distribution (${N} parallel): p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms`,
    );

    expect(p50).toBeLessThan(15000);
    expect(p95).toBeLessThan(25000);
    expect(p99).toBeLessThan(40000);
  }, 60000);

  it('quantifies event loop blocking during concurrent work (informational)', async () => {
    const payloads = Array.from(
      { length: 20 },
      (_, i) => `class Blocker${i} { heavy = "x".repeat(5000); }`,
    );

    const tickCount = { n: 0 };
    const tickInterval = setInterval(() => {
      tickCount.n += 1;
    }, 10);

    try {
      const t = performance.now();
      await Promise.all(payloads.map((p) => pipeline.anonymize(p)));
      const elapsed = performance.now() - t;

      const expectedTicks = Math.floor(elapsed / 10);
      const actualTicks = tickCount.n;
      const tickRatio = actualTicks / Math.max(1, expectedTicks);

      console.log(
        `Event loop during 20 concurrent: ${actualTicks}/${expectedTicks} ticks (${(tickRatio * 100).toFixed(0)}%) over ${elapsed.toFixed(0)}ms`,
      );
      console.log('  This quantifies that tree-sitter WASM parsing is synchronous:');
      console.log('  low tick ratio confirms BENCHMARKS.md claim that concurrent requests queue.');

      expect(elapsed).toBeLessThan(60000);
    } finally {
      clearInterval(tickInterval);
    }
  }, 90000);
});
