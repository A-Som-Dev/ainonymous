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

describe('rehydrate ipv6 canonical-form matching', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('rehydrates when upstream expands a pseudonym ipv6 with leading zeros', async () => {
    const p = build();
    const original = '2001:db8::1';
    const { text: a } = await p.anonymize(`host ${original}`);
    const pseudoMatch = a.match(/2001:db8:[0-9a-f:]+/i);
    expect(pseudoMatch).not.toBeNull();
    const pseudo = pseudoMatch![0];
    // Upstream rewrites the same pseudo with leading-zero padding
    const padded = pseudo
      .split(':')
      .map((g) => (g === '' ? '' : g.padStart(4, '0')))
      .join(':');
    const out = p.rehydrate(`Result: ${padded}`);
    expect(out).toContain(original);
  });

  it('does not crash on IPv4-mapped IPv6 shorthand', async () => {
    const p = build();
    await p.anonymize('host 2001:db8::1');
    const out = p.rehydrate('Response mentions ::ffff:1.2.3.4 server');
    expect(out).toBe('Response mentions ::ffff:1.2.3.4 server');
  });

  it('does not crash on IPv6 with zone identifier', async () => {
    const p = build();
    await p.anonymize('host 2001:db8::1');
    const out = p.rehydrate('Response from fe80::1%eth0');
    expect(out).toBe('Response from fe80::1%eth0');
  });

  it('rehydrates when upstream uppercases the pseudonym ipv6', async () => {
    const p = build();
    const original = '2001:db8::beef';
    const { text: a } = await p.anonymize(`host ${original}`);
    const pseudo = a.match(/2001:db8:[0-9a-f:]+/i)![0];
    const caps = pseudo.toUpperCase();
    const out = p.rehydrate(`Result: ${caps}`);
    expect(out).toContain(original);
  });
});
