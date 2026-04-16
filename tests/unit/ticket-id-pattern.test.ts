import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe("Ticket-ID pseudonymization", () => {
  beforeAll(async () => {
    await initParser();
  });

  it('pseudonymizes Jira-style ticket IDs in prose', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    const text = 'Fix laut PROJ-1234 und NET-42 bitte.';
    const result = await pipeline.anonymize(text);
    expect(result.text).not.toContain('PROJ-1234');
    expect(result.text).not.toContain('NET-42');
  });

  it('pseudonymizes GitHub/ADO-style hash-prefixed ticket IDs', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    const text = 'Ich arbeite an Ticket #4913228 und issue #789.';
    const result = await pipeline.anonymize(text);
    expect(result.text).not.toContain('#4913228');
    expect(result.text).not.toContain('#789');
  });

  it('does not match plain uppercase words without dash+digits', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    const text = 'HELLO and WORLD are two plain words.';
    const result = await pipeline.anonymize(text);
    expect(result.text).toContain('HELLO');
    expect(result.text).toContain('WORLD');
  });

  it('does not match numbers without # prefix or uppercase prefix', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    const text = 'Port 8080, timeout 5000ms, retry 3 times.';
    const result = await pipeline.anonymize(text);
    expect(result.text).toContain('8080');
    expect(result.text).toContain('5000');
  });
});
