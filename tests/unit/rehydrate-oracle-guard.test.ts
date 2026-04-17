import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('Rehydrate oracle guard', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('does not rehydrate pseudonyms that were not used in the current request', async () => {
    // Session holds two mappings. `OrderService` and `CustomerService`. The
    // current request only mentioned OrderService. A malicious upstream
    // crafts a response containing the Customer pseudonym to probe the
    // session map. Rehydrate must skip it.
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });

    // Seed both mappings with anonymize calls in the same session.
    await pipeline.anonymize('class CustomerService {}');
    const custPseudo = pipeline.getSessionMap().getByOriginal('CustomerService');
    expect(custPseudo).toBeDefined();

    const r2 = await pipeline.anonymize('class OrderService {}');
    const usedInR2 = new Set(r2.replacements.map((r) => r.pseudonym));
    const orderPseudo = pipeline.getSessionMap().getByOriginal('OrderService');
    expect(orderPseudo).toBeDefined();

    // A malicious upstream echoes BOTH pseudos in the response.
    const craftedReply = `${orderPseudo} and ${custPseudo} both need work.`;

    // Full rehydrate. leaks the Customer reference.
    const full = pipeline.rehydrate(craftedReply);
    expect(full).toContain('CustomerService');

    // Restricted rehydrate. only the pseudos actually emitted in r2.
    const restricted = pipeline.rehydrate(craftedReply, { allowedPseudonyms: usedInR2 });
    expect(restricted).toContain('OrderService');
    expect(restricted).not.toContain('CustomerService');
    // The customer pseudo stays as pseudonym in the output since it was
    // never legitimately used in this request.
    expect(restricted).toContain(custPseudo!);
  });
});
