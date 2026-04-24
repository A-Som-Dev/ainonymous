import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

function build(): Pipeline {
  return new Pipeline({
    ...getDefaults(),
    identity: { company: 'AcmeCorp', domains: [], people: [] },
    code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
  });
}

describe('rehydrate with format-char smuggling', () => {
  beforeAll(async () => {
    await initParser();
  });
  it('rehydrates a pseudonym split by a zero-width joiner', async () => {
    const p = build();
    const { text: a } = await p.anonymize('AcmeCorp ships tomorrow');
    const pseudoMatch = a.match(/\b[A-Z][a-zA-Z0-9]+\b/);
    expect(pseudoMatch).not.toBeNull();
    const pseudo = pseudoMatch![0];
    // Upstream response smuggles a ZWJ into the middle of the pseudonym
    const smuggled = pseudo.slice(0, 2) + '\u200D' + pseudo.slice(2);
    const out = p.rehydrate(`Upstream says: ${smuggled} ships tomorrow`);
    expect(out).toContain('AcmeCorp');
    expect(out).not.toContain('\u200D');
  });

  it('rehydrates across a combining grapheme joiner injection', async () => {
    const p = build();
    const { text: a } = await p.anonymize('AcmeCorp is critical');
    const pseudo = a.match(/\b[A-Z][a-zA-Z0-9]+\b/)![0];
    const smuggled = pseudo.slice(0, 1) + '\u034F' + pseudo.slice(1);
    const out = p.rehydrate(`Result: ${smuggled} is critical`);
    expect(out).toContain('AcmeCorp');
  });

  it('rehydrates when multiple format chars are interleaved', async () => {
    const p = build();
    const { text: a } = await p.anonymize('AcmeCorp');
    const pseudo = a.match(/\b[A-Z][a-zA-Z0-9]+\b/)![0];
    const smuggled = pseudo.split('').join('\u200B');
    const out = p.rehydrate(smuggled);
    expect(out).toContain('AcmeCorp');
  });
});
