import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { initParser } from '../../src/ast/extractor.js';
import { getDefaults } from '../../src/config/loader.js';

describe('NER pipeline integration', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });

  beforeEach(() => {
    // No people configured - NER must catch them
    pipeline = new Pipeline({
      ...getDefaults(),
      identity: {
        company: '',
        domains: [],
        people: [],
      },
    });
  });

  it('catches unconfigured German names', async () => {
    const result = await pipeline.anonymize('Fix von Hans Meier gemeldet');
    expect(result.text).not.toContain('Hans Meier');
    // Caught by NER or OpenRedaction - either way, the name is gone
    const nameHit = result.replacements.some(
      (r) => r.type === 'person-name-ner' || r.type === 'person-name' || r.type === 'name',
    );
    expect(nameHit).toBe(true);
  });

  it('catches names in code comments', async () => {
    const result = await pipeline.anonymize('// Author: Stefan Schneider\nfunction hello() {}');
    expect(result.text).not.toContain('Stefan Schneider');
  });

  it('catches names with Dr. prefix', async () => {
    const result = await pipeline.anonymize('Reviewed by Dr. Maria Weber on 2024-01-15');
    expect(result.text).not.toContain('Maria Weber');
  });

  it('uses consistent pseudonyms across calls', async () => {
    const r1 = await pipeline.anonymize('Thomas Müller hat den Bug gefunden.');
    const r2 = await pipeline.anonymize('Thomas Müller hat ihn gefixt.');

    const pseudo1 = r1.replacements.find((r) => r.original === 'Thomas Müller')?.pseudonym;
    const pseudo2 = r2.replacements.find((r) => r.original === 'Thomas Müller')?.pseudonym;

    expect(pseudo1).toBeDefined();
    expect(pseudo1).toBe(pseudo2);
  });

  it('does not anonymize code identifiers', async () => {
    const code = 'class ServiceHandler {\n  private final String configValue;\n}';
    const result = await pipeline.anonymize(code);
    expect(result.text).toContain('ServiceHandler');
    expect(result.text).toContain('configValue');
  });

  it('leaves text without names unchanged', async () => {
    const text = 'The build pipeline runs all unit tests.';
    const result = await pipeline.anonymize(text);
    // No NER hits expected
    const nerReplacements = result.replacements.filter((r) => r.type === 'person-name-ner');
    expect(nerReplacements).toHaveLength(0);
  });

  it('rehydrates NER-detected names', async () => {
    const original = 'Bericht von Sebastian Richter';
    const anonymized = await pipeline.anonymize(original);
    expect(anonymized.text).not.toContain('Sebastian Richter');

    const rehydrated = pipeline.rehydrate(anonymized.text);
    expect(rehydrated).toContain('Sebastian Richter');
  });
});
