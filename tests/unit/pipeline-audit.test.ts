import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { AuditLogger } from '../../src/audit/logger.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('Pipeline with AuditLogger', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('logs replacements when logger is provided', async () => {
    const logger = new AuditLogger();
    const config = {
      ...getDefaults(),
      identity: {
        company: 'TestCo',
        domains: ['testco.internal'],
        people: [],
      },
    };
    const pipeline = new Pipeline(config, logger);

    await pipeline.anonymize('Contact dev@testco.internal for details');

    const stats = logger.stats();
    expect(stats.total).toBeGreaterThan(0);
    expect(logger.entries().length).toBeGreaterThan(0);
  });

  it('does not crash without logger', async () => {
    const config = getDefaults();
    const pipeline = new Pipeline(config);

    const result = await pipeline.anonymize('Hello world');
    expect(result.text).toBeDefined();
  });

  it('tracks stats per layer', async () => {
    const logger = new AuditLogger();
    const config = {
      ...getDefaults(),
      identity: {
        company: 'Acme Corp',
        domains: ['acme.io'],
        people: [],
      },
    };
    const pipeline = new Pipeline(config, logger);

    await pipeline.anonymize('key=AKIAIOSFODNN7EXAMPLE server=prod.acme.io');

    const stats = logger.stats();
    expect(stats.secrets).toBeGreaterThan(0);
  });
});
