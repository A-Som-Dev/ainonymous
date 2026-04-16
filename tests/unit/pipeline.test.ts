import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('Pipeline', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });

  beforeEach(() => {
    const config = {
      ...getDefaults(),
      identity: {
        company: 'Asom GmbH',
        domains: ['asom.internal'],
        people: [],
      },
      code: {
        ...getDefaults().code,
        domainTerms: ['Customer', 'Order'],
        preserve: ['Express'],
      },
    };
    pipeline = new Pipeline(config);
  });

  it('runs all three layers', async () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE email=dev@asom.internal class CustomerService {}';
    const result = await pipeline.anonymize(input);
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).not.toContain('asom.internal');
    expect(result.text).not.toContain('Customer');
    expect(result.text).toContain('***REDACTED***');
  });

  it('tracks all replacements', async () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE email=dev@asom.internal';
    const result = await pipeline.anonymize(input);
    expect(result.replacements.length).toBeGreaterThanOrEqual(2);
    const layers = new Set(result.replacements.map((r) => r.layer));
    expect(layers.has('secrets')).toBe(true);
  });

  it('rehydrates pseudonyms back to originals', async () => {
    const input = 'server: asom.internal';
    const result = await pipeline.anonymize(input);
    const pseudo = result.text;
    const back = pipeline.rehydrate(pseudo);
    expect(back).toContain('asom.internal');
  });

  it('does not rehydrate secrets', async () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE';
    await pipeline.anonymize(input);
    const back = pipeline.rehydrate('***REDACTED***');
    expect(back).toContain('***REDACTED***');
  });

  it('session map persists across calls', async () => {
    await pipeline.anonymize('Asom GmbH');
    const result = await pipeline.anonymize('Welcome to Asom GmbH');
    const parts = result.text.split(' ');
    expect(parts[parts.length - 1]).not.toBe('Corp');
  });
});
