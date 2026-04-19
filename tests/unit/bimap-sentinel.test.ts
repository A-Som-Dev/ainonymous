import { describe, it, expect } from 'vitest';
import { BiMap } from '../../src/session/map.js';

describe('BiMap sentinel handling', () => {
  it('accepts multiple originals mapped to ***ANONYMIZED*** without collision throw', () => {
    const m = new BiMap();
    m.set('12345', '***ANONYMIZED***', 'identity', 'unknown-pii');
    expect(() => m.set('67890', '***ANONYMIZED***', 'identity', 'unknown-pii')).not.toThrow();
  });

  it('accepts multiple originals mapped to ***REDACTED*** (secrets sentinel)', () => {
    const m = new BiMap();
    m.set('secret-one', '***REDACTED***', 'secrets', 'api-key');
    expect(() => m.set('secret-two', '***REDACTED***', 'secrets', 'api-key')).not.toThrow();
  });

  it('sentinels are not rehydratable (getByPseudonym returns undefined)', () => {
    const m = new BiMap();
    m.set('12345', '***ANONYMIZED***', 'identity', 'unknown-pii');
    expect(m.getByPseudonym('***ANONYMIZED***')).toBeUndefined();
  });

  it('non-sentinel pseudonym collision still throws for real identifier conflict', () => {
    const m = new BiMap();
    m.set('orig-a', 'Person Alpha', 'identity', 'person-name');
    expect(() => m.set('orig-b', 'Person Alpha', 'identity', 'person-name')).toThrow(
      /pseudonym collision/,
    );
  });

  it('getByOriginal resolves through sentinel fanout', () => {
    const m = new BiMap();
    m.set('original-1', '***ANONYMIZED***', 'identity', 'x');
    m.set('original-2', '***ANONYMIZED***', 'identity', 'x');
    expect(m.getByOriginal('original-1')).toBe('***ANONYMIZED***');
    expect(m.getByOriginal('original-2')).toBe('***ANONYMIZED***');
  });
});
