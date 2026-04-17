import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('Rehydrate must not replace pseudos inside larger words', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('does not rewrite plain words that contain a pseudo as substring', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    // Only a single identifier → pseudo is `Alpha` (5 chars, alphanumeric).
    await pipeline.anonymize('class Whatever {}');
    const pseudo = pipeline.getSessionMap().getByOriginal('Whatever');
    expect(pseudo).toBeDefined();

    // A response that contains the pseudo as a substring of a real word.
    // `Alpha` → could be inside `Alphabet`. The whole word `Alphabet` must
    // stay intact; only standalone `Alpha` occurrences get rehydrated.
    const bigger = `${pseudo}bet`;
    const response = `The ${bigger} is a set of letters.`;
    const back = pipeline.rehydrate(response);
    expect(back).toContain(bigger);
  });

  it('still rehydrates a word-bounded pseudo occurrence', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    await pipeline.anonymize('class Foo {}');
    const sessionMap = pipeline.getSessionMap();
    const fooPseudo = sessionMap.getByOriginal('Foo');
    expect(fooPseudo).toBeDefined();
    const response = `Rename ${fooPseudo} to something better.`;
    const back = pipeline.rehydrate(response);
    expect(back).toContain('Foo');
  });

  it('rehydrates pseudos with punctuation boundaries (dots, dashes, @)', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    await pipeline.anonymize('Contact alice@example.com');
    const sessionMap = pipeline.getSessionMap();
    // Whatever pseudo the email got, it must come back through rehydrate
    // exactly when referenced on its own. even though regex word boundary
    // doesn't apply to `@` or `.`.
    const pseudo = sessionMap.getByOriginal('alice@example.com');
    if (pseudo) {
      const back = pipeline.rehydrate(`Reach out via ${pseudo}.`);
      expect(back).toContain('alice@example.com');
    }
  });
});
