import { describe, it, expect } from 'vitest';
import { assertDetectorPlugin, type DetectorPlugin } from '../../src/plugin-api/index.js';
import { DetectorRegistry } from '../../src/plugin-api/registry.js';

describe('plugin-api assertDetectorPlugin', () => {
  it('accepts a well-formed plugin', () => {
    const p: DetectorPlugin = {
      id: 'sample',
      version: '1.0.0',
      capabilities: ['secrets'],
      detect: () => [],
    };
    expect(() => assertDetectorPlugin(p)).not.toThrow();
  });

  it('rejects an object without id', () => {
    expect(() => assertDetectorPlugin({ version: '1.0.0', capabilities: [], detect: () => [] })).toThrow(/id/);
  });

  it('rejects a plugin without detect()', () => {
    expect(() =>
      assertDetectorPlugin({ id: 'x', version: '1.0.0', capabilities: [] }),
    ).toThrow(/detect/);
  });

  it('rejects non-object inputs', () => {
    expect(() => assertDetectorPlugin(null)).toThrow();
    expect(() => assertDetectorPlugin('a string')).toThrow();
  });

  it('rejects ids that contain a colon (would defeat namespace-disable)', () => {
    expect(() =>
      assertDetectorPlugin({ id: 'plugin:fake', version: '1.0.0', capabilities: [], detect: () => [] }),
    ).toThrow(/id/i);
  });

  it('rejects ids with uppercase or whitespace', () => {
    expect(() =>
      assertDetectorPlugin({ id: 'BadCase', version: '1.0.0', capabilities: [], detect: () => [] }),
    ).toThrow(/id/i);
    expect(() =>
      assertDetectorPlugin({ id: 'has space', version: '1.0.0', capabilities: [], detect: () => [] }),
    ).toThrow(/id/i);
  });

  it('rejects ids longer than 64 chars', () => {
    expect(() =>
      assertDetectorPlugin({ id: 'a'.repeat(65), version: '1.0.0', capabilities: [], detect: () => [] }),
    ).toThrow(/id/i);
  });

  it('accepts kebab-case, dot-segment and underscore ids', () => {
    expect(() =>
      assertDetectorPlugin({ id: 'org.acme.scanner_v1', version: '1.0.0', capabilities: [], detect: () => [] }),
    ).not.toThrow();
    expect(() =>
      assertDetectorPlugin({ id: 'a-b-c', version: '1.0.0', capabilities: [], detect: () => [] }),
    ).not.toThrow();
  });

  it('rejects double or trailing separators', () => {
    for (const bad of ['a--b', 'a..b', 'a__b', 'a-', 'a.', 'a_', '-a', '.a', '_a', 'a.-b']) {
      expect(() =>
        assertDetectorPlugin({ id: bad, version: '1.0.0', capabilities: [], detect: () => [] }),
      ).toThrow(/id/i);
    }
  });
});

describe('DetectorRegistry.register asserts plugin shape', () => {
  it('throws when registering a plugin with a colon id', () => {
    const r = new DetectorRegistry();
    expect(() =>
      r.register({
        id: 'plugin:fake',
        version: '1.0.0',
        capabilities: ['secrets'],
        detect: () => [],
      } as unknown as DetectorPlugin),
    ).toThrow(/id/i);
  });

  it('throws when registering an object missing detect()', () => {
    const r = new DetectorRegistry();
    expect(() =>
      r.register({ id: 'ok', version: '1.0.0', capabilities: [] } as unknown as DetectorPlugin),
    ).toThrow(/detect/i);
  });

  it('accepts a well-formed plugin', () => {
    const r = new DetectorRegistry();
    expect(() =>
      r.register({
        id: 'good-one',
        version: '1.0.0',
        capabilities: ['secrets'],
        detect: () => [],
      }),
    ).not.toThrow();
    expect(r.list()).toHaveLength(1);
  });

  it('freezes the plugin id so a runtime getter cannot spoof a different value later', async () => {
    let calls = 0;
    const evil: Record<string, unknown> = {
      version: '1.0.0',
      capabilities: ['secrets'],
      detect: () => [
        { type: 'apikey', offset: 0, length: 1, match: 'x' },
      ],
    };
    Object.defineProperty(evil, 'id', {
      get(): string {
        calls += 1;
        // first read (assertDetectorPlugin) returns clean id, later reads
        // return a spoofed id that would defeat disabledDetectorIds
        return calls === 1 ? 'safe-id' : 'plugin:spoofed';
      },
      enumerable: true,
      configurable: true,
    });

    const r = new DetectorRegistry();
    r.register(evil as unknown as DetectorPlugin);

    const hits = await r.detectByCapability(['secrets'], 'x', { preset: '', aggression: 'medium' });
    for (const h of hits) {
      expect(h.type.startsWith('plugin:plugin:')).toBe(false);
    }
  });
});
