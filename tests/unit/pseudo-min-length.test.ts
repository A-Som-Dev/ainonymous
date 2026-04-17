import { describe, it, expect, beforeEach } from 'vitest';
import { PseudoGen } from '../../src/pseudo.js';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';
import { beforeAll } from 'vitest';

describe('PseudoGen identifier minimum length', () => {
  let gen: PseudoGen;

  beforeEach(() => {
    gen = new PseudoGen();
  });

  it('never emits a pseudonym shorter than 3 characters', () => {
    // Burn through at least two full Greek cycles to hit every name including
    // Mu/Nu/Xi/Pi which were the substring-collision culprits (null -> matchingll,
    // der -> derll). 60 iterations cover 2+ cycles with suffix numbering.
    for (let i = 0; i < 60; i++) {
      const pseudo = gen.identifier(`token${i}`);
      expect(pseudo.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not substring-match against common English/German words', () => {
    // The original derll / matchingll bug was caused by `nu` (pseudo for
    // `der` / `matching`) being a substring of `null`. Enumerate every pseudo
    // from the first few cycles and verify none of them is a substring of a
    // common programming-language keyword or German article.
    const forbiddenHosts = ['null', 'the', 'for', 'int', 'try', 'new', 'any', 'der', 'das', 'nur'];
    const pseudos = new Set<string>();
    for (let i = 0; i < 60; i++) pseudos.add(gen.identifier(`t${i}`));

    for (const word of forbiddenHosts) {
      for (const p of pseudos) {
        expect(word.includes(p), `pseudo "${p}" is a substring of "${word}"`).toBe(false);
      }
    }
  });
});

describe('Rehydrate substring-collision regression', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('does not rewrite `null` to anything after anonymizing a code snippet with matching-identifiers', async () => {
    // Reproduces the exact cumulative-session bug from the hardcore E2E:
    // a Java identifier split on camelCase produces `matching` as a part,
    // gets pseudonymized to a 2-char Greek, then that pseudo collides with
    // `null` at rehydrate time → `null` becomes `matchingll`.
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });

    await pipeline.anonymize(
      [
        '```java',
        'class Foo {',
        '  List<Subscription> matchingSubscriptions = repo.findMatchingFieldSubscriptions(id);',
        '}',
        '```',
      ].join('\n'),
    );

    const cases = [
      'if (x != null) return null;',
      'null-sicher',
      'stop_sequence:null',
      'Object o = null;',
    ];
    for (const c of cases) {
      const out = pipeline.rehydrate(c);
      expect(out, `rehydrate of "${c}" should be stable`).toBe(c);
    }
  });
});
