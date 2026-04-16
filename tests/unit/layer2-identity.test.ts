import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityLayer } from '../../src/pipeline/layer2-identity.js';
import { BiMap } from '../../src/session/map.js';
import { getDefaults } from '../../src/config/loader.js';
import type { PipelineContext } from '../../src/types.js';

describe('IdentityLayer', () => {
  let layer: IdentityLayer;
  let ctx: PipelineContext;

  beforeEach(() => {
    layer = new IdentityLayer();
    ctx = {
      sessionMap: new BiMap(),
      config: {
        ...getDefaults(),
        identity: {
          company: 'Asom GmbH',
          domains: ['asom.de', 'asom.internal'],
          people: ['Artur Sommer'],
        },
      },
    };
  });

  it('replaces company name', () => {
    const result = layer.process('Welcome to Asom GmbH portal', ctx);
    expect(result.text).not.toContain('Asom GmbH');
    expect(result.replacements).toHaveLength(1);
  });

  it('replaces configured domains', () => {
    const result = layer.process('server: api.asom.internal', ctx);
    expect(result.text).not.toContain('asom.internal');
  });

  it('replaces configured people', () => {
    const result = layer.process('author: Artur Sommer', ctx);
    expect(result.text).not.toContain('Artur Sommer');
    expect(result.text).toMatch(/Person [A-Z]/);
  });

  it('pseudonymizes emails found by pattern', () => {
    const result = layer.process('mail: artur@asom.de', ctx);
    expect(result.text).not.toContain('artur@asom.de');
    expect(result.text).toMatch(/user\d+@company-/);
  });

  it('pseudonymizes IPs found by pattern', () => {
    const result = layer.process('host: 192.168.1.50', ctx);
    expect(result.text).not.toContain('192.168.1.50');
    expect(result.text).toMatch(/10\.0\./);
  });

  it('is consistent within a session', () => {
    const r1 = layer.process('Asom GmbH rocks', ctx);
    const r2 = layer.process('Asom GmbH rules', ctx);
    const pseudo1 = r1.text.replace(' rocks', '');
    const pseudo2 = r2.text.replace(' rules', '');
    expect(pseudo1).toBe(pseudo2);
  });

  it('registers replacements in session map', () => {
    layer.process('mail: artur@asom.de', ctx);
    expect(ctx.sessionMap.size).toBeGreaterThan(0);
  });

  it('leaves unrelated text alone', () => {
    const text = 'generic function that does stuff';
    const result = layer.process(text, ctx);
    expect(result.text).toBe(text);
  });
});
