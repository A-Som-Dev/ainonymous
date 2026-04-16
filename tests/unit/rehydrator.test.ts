import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('rehydration', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });

  beforeEach(() => {
    pipeline = new Pipeline({
      ...getDefaults(),
      identity: {
        company: 'Asom GmbH',
        domains: ['asom.internal'],
        people: ['Artur Sommer'],
      },
      code: {
        ...getDefaults().code,
        domainTerms: ['Customer', 'Order'],
        preserve: [],
      },
    });
  });

  it('rehydrates identity pseudonyms', async () => {
    await pipeline.anonymize('Contact Asom GmbH for details');
    const map = pipeline.getSessionMap();
    const companyPseudo = map.getByOriginal('Asom GmbH');
    if (companyPseudo) {
      const back = pipeline.rehydrate(`Contact ${companyPseudo} for details`);
      expect(back).toContain('Asom GmbH');
    }
  });

  it('rehydrates code pseudonyms', async () => {
    await pipeline.anonymize('class CustomerService {}');
    const map = pipeline.getSessionMap();
    const customerPseudo = map.getByOriginal('Customer');
    if (customerPseudo) {
      const response = `class ${customerPseudo}Service {}`;
      const back = pipeline.rehydrate(response);
      expect(back).toContain('Customer');
    }
  });

  it('does not rehydrate REDACTED markers', async () => {
    await pipeline.anonymize('secret=AKIAIOSFODNN7EXAMPLE');
    const back = pipeline.rehydrate('The key is ***REDACTED***');
    expect(back).toContain('***REDACTED***');
    expect(back).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('handles SSE chunks with pseudonyms', async () => {
    await pipeline.anonymize('server: asom.internal');
    const map = pipeline.getSessionMap();
    const domainPseudo = map.getByOriginal('asom.internal');
    if (domainPseudo) {
      const chunk = `data: {"type":"content_block_delta","delta":{"text":"connect to ${domainPseudo}"}}\n\n`;
      const back = pipeline.rehydrate(chunk);
      expect(back).toContain('asom.internal');
    }
  });

  it('does not cascade when an original contains another pseudonym as substring', () => {
    // scenario from BSI review 1.5: original "AlphaLambda" contains pseudonym "Lambda"
    // Setting up the map directly avoids relying on pseudonym generation
    const map = pipeline.getSessionMap();
    map.set('customerA', 'Lambda', 'identity', 'test');
    map.set('AlphaLambda', 'XYZ', 'identity', 'test');

    const response = 'Hello XYZ, meet Lambda.';
    const back = pipeline.rehydrate(response);

    // XYZ → AlphaLambda, Lambda → customerA. AlphaLambda must stay intact
    // (not corrupted into "AlphacustomerA" by cascading replace).
    expect(back).toBe('Hello AlphaLambda, meet customerA.');
  });

  it('rehydrates separated pseudonyms independently', () => {
    const map = pipeline.getSessionMap();
    map.set('foo', 'AlphaP', 'identity', 'test');
    map.set('bar', 'BetaP', 'identity', 'test');

    const back = pipeline.rehydrate('use AlphaP and BetaP');
    expect(back).toBe('use foo and bar');
  });
});
