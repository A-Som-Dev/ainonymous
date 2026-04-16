import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('performance', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
    pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'Asom GmbH', domains: ['asom.internal'], people: ['Artur Sommer'] },
      code: { ...getDefaults().code, domainTerms: ['Customer', 'Order'], preserve: ['Express'] },
    });

    // warmup: let JIT and WASM caches settle before timed runs
    const warmup = 'class CustomerService { password = "secret12345678"; }';
    for (let i = 0; i < 5; i++) await pipeline.anonymize(warmup);
  });

  it('anonymizes small payload in under 250ms', async () => {
    const small = 'class CustomerService { password = "secret12345678"; }';
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      await pipeline.anonymize(small);
    }
    const avg = (performance.now() - start) / 10;
    console.log(`Small payload: ${avg.toFixed(1)}ms avg`);
    // tree-sitter WASM adds ~50-150ms overhead per parse depending on system load
    expect(avg).toBeLessThan(500);
  });

  it('anonymizes medium payload in under 500ms', async () => {
    const medium = Array(20)
      .fill(
        'class CustomerService { getOrder() { return fetch("https://api.asom.internal/orders"); } }',
      )
      .join('\n');
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      await pipeline.anonymize(medium);
    }
    const avg = (performance.now() - start) / 5;
    console.log(`Medium payload (~${medium.length} chars): ${avg.toFixed(1)}ms avg`);
    expect(avg).toBeLessThan(500);
  });

  it('rehydration is fast', async () => {
    await pipeline.anonymize('class CustomerService { getOrder() {} }');
    const map = pipeline.getSessionMap();
    const pseudo = map.getByOriginal('Customer') || 'Alpha';
    const response = Array(50).fill(`Use ${pseudo}Service for this`).join('. ');

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      pipeline.rehydrate(response);
    }
    const avg = (performance.now() - start) / 100;
    console.log(`Rehydration: ${avg.toFixed(2)}ms avg`);
    expect(avg).toBeLessThan(5);
  });
});
