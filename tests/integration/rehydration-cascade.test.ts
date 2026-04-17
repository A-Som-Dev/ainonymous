import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('v1.2 rehydration cascade across layers', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('rehydrates LLM response that mentions both class pseudo and company pseudo', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });

    const source = [
      'package com.acme.orders;',
      '',
      'import com.acme.shared.OrderProcessor;',
      '',
      'public class OrderProcessor {',
      '  private final OrderProcessor delegate;',
      '  public void run() {}',
      '}',
    ].join('\n');

    await pipeline.anonymize(source);
    const map = pipeline.getSessionMap();

    const orderPseudo = map.getByOriginal('OrderProcessor');
    expect(orderPseudo).toBeDefined();

    // An LLM response like "Rename OrderProcessor to OrderProcessor2". but
    // using the pseudo. should rehydrate back to the real class name.
    const llmOut = `The class ${orderPseudo} should be renamed to ${orderPseudo}V2.`;
    const back = pipeline.rehydrate(llmOut);

    expect(back).toContain('OrderProcessor');
    expect(back).toContain('OrderProcessorV2');
    expect(back).not.toContain(orderPseudo!);
  });

  it('rehydrates compound pseudos that contain company+class substrings', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });

    const source = [
      'package com.acme.svc;',
      '',
      'public class AcmeInvoiceService {',
      '  public void process() {}',
      '}',
    ].join('\n');

    const anonymized = await pipeline.anonymize(source);
    expect(anonymized.text).not.toContain('AcmeInvoiceService');

    const back = pipeline.rehydrate(anonymized.text);
    expect(back).toContain('AcmeInvoiceService');
  });
});
