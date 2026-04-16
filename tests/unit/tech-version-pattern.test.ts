import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('Tech-version string redaction', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('strips specific version numbers from well-known tech brands in prose', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    const text =
      'Wir nutzen Spring Boot 3.2, Java 17, Oracle 19c, Camunda 7.20 und Playwright 1.49 auf Docker 24.';
    const result = await pipeline.anonymize(text);

    // Versions removed
    expect(result.text).not.toContain('3.2');
    expect(result.text).not.toContain('19c');
    expect(result.text).not.toContain('7.20');
    expect(result.text).not.toContain('1.49');

    // Brand names preserved (the LLM still needs tech context)
    expect(result.text).toContain('Spring Boot');
    expect(result.text).toContain('Java');
    expect(result.text).toContain('Oracle');
    expect(result.text).toContain('Camunda');
    expect(result.text).toContain('Playwright');
    expect(result.text).toContain('Docker');
  });

  it('does not touch version-like strings that are not preceded by a known tech brand', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    const text = 'Order 4711 costs 3.99 EUR, height 1.82m, limit 99.5%.';
    const result = await pipeline.anonymize(text);
    expect(result.text).toContain('4711');
    expect(result.text).toContain('3.99');
    expect(result.text).toContain('1.82');
  });
});
