import { describe, it, expect } from 'vitest';
import { IdentityLayer } from '../../src/pipeline/layer2-identity.js';
import { BiMap } from '../../src/session/map.js';
import { AuditLogger } from '../../src/audit/logger.js';
import type { PipelineContext, AInonymousConfig, PatternMatch } from '../../src/types.js';

function ctx(): PipelineContext {
  const cfg = {
    version: 1,
    secrets: { patterns: [] },
    identity: { company: '', domains: [], people: [] },
    code: {
      language: 'auto',
      domainTerms: [],
      preserve: [],
      sensitivePaths: [],
      redactBodies: [],
    },
    behavior: {
      interactive: false,
      auditLog: false,
      auditDir: '',
      dashboard: false,
      port: 8100,
      compliance: 'hipaa',
      aggression: 'medium',
      auditFailure: 'permit',
      upstream: { anthropic: '', openai: '' },
      mgmtToken: '',
    },
    session: { persist: false, persistPath: '' },
  } as unknown as AInonymousConfig;
  return {
    config: cfg,
    sessionMap: new BiMap(),
    auditLogger: new AuditLogger(),
  };
}

function hit(type: string, match: string, offset: number): PatternMatch {
  return { type, match, offset, length: match.length };
}

describe('expanded PII types round-trip under hipaa', () => {
  it('two distinct SSNs get distinct pseudonyms and rehydrate', () => {
    const layer = new IdentityLayer();
    const c = ctx();
    const text = 'Patient A SSN 123-45-6789. Patient B SSN 987-65-4321.';
    const hits = [
      hit('ssn', '123-45-6789', text.indexOf('123-45-6789')),
      hit('ssn', '987-65-4321', text.indexOf('987-65-4321')),
    ];
    const layerWithHits = layer as unknown as {
      applyPatternHits: (
        t: string,
        h: PatternMatch[],
        r: unknown[],
        ctx: PipelineContext,
      ) => { text: string; replacements: Array<{ pseudonym: string; original: string }> };
    };
    const res = layerWithHits.applyPatternHits(text, hits, [], c);
    const pseudos = res.replacements.map((r) => r.pseudonym);
    expect(pseudos[0]).not.toBe('***ANONYMIZED***');
    expect(pseudos[1]).not.toBe('***ANONYMIZED***');
    expect(pseudos[0]).not.toBe(pseudos[1]);
    // rehydrate: find original by pseudonym
    for (const r of res.replacements) {
      const got = c.sessionMap.getByPseudonym(r.pseudonym);
      expect(got).toBe(r.original);
    }
  });

  it('aadhaar, passport-us, driving-license-us all skip sentinel', () => {
    const layer = new IdentityLayer();
    const c = ctx();
    const text = 'aad 1234 5678 9012 pass A12345678 dl D7654321';
    const layerWithHits = layer as unknown as {
      applyPatternHits: (
        t: string,
        h: PatternMatch[],
        r: unknown[],
        ctx: PipelineContext,
      ) => { text: string; replacements: Array<{ pseudonym: string; original: string }> };
    };
    const res = layerWithHits.applyPatternHits(
      text,
      [
        hit('india-aadhaar', '1234 5678 9012', text.indexOf('1234')),
        hit('passport-us', 'A12345678', text.indexOf('A12345678')),
        hit('driving-license-us', 'D7654321', text.indexOf('D7654321')),
      ],
      [],
      c,
    );
    for (const r of res.replacements) {
      expect(r.pseudonym).not.toBe('***ANONYMIZED***');
    }
  });
});
