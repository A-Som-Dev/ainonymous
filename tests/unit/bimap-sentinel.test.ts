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

  it('rejects originals that are themselves a sentinel literal', () => {
    const m = new BiMap();
    expect(() => m.set('***REDACTED***', 'Psi1', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
    expect(() => m.set('***ANONYMIZED***', 'Psi2', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
  });

  it('rejects sentinel-shaped originals with zero-width or trailing chars', () => {
    const m = new BiMap();
    expect(() => m.set('***REDACTED\u200B***', 'Psi1', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
    expect(() => m.set('***REDACTED***\n', 'Psi2', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
    expect(() => m.set('***REDACTED*** ', 'Psi3', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
    expect(() => m.set('***redacted***', 'Psi4', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
    expect(() => m.set('***AnOnYmIzEd***', 'Psi5', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
  });

  it('rejects sentinel-shaped originals built from fullwidth or confusable asterisks', () => {
    const m = new BiMap();
    // U+FF0A Fullwidth Asterisk - NFKC folds to '*'
    expect(() =>
      m.set('\uFF0A\uFF0A\uFF0AREDACTED\uFF0A\uFF0A\uFF0A', 'Psi1', 'code', 'identifier'),
    ).toThrow(/sentinel-shaped original/);
    // Hangul Jungseong filler (U+1160) between the asterisks and the word
    expect(() => m.set('***\u1160REDACTED***', 'Psi2', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
  });

  it('rejects sentinel-shaped originals that use cyrillic homoglyphs for the word', () => {
    const m = new BiMap();
    // RЕDACTED with Cyrillic Ye U+0415 instead of Latin E
    expect(() => m.set('***R\u0415DACTED***', 'Psi1', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
    // ANONYMIZED with Cyrillic O (U+041E) substitutions
    expect(() => m.set('***AN\u041ENYMIZED***', 'Psi2', 'code', 'identifier')).toThrow(
      /sentinel-shaped original/,
    );
  });

  it('tracks how many originals fan out to each sentinel', () => {
    const m = new BiMap();
    m.set('orig-1', '***ANONYMIZED***', 'identity', 'pii');
    m.set('orig-2', '***ANONYMIZED***', 'identity', 'pii');
    m.set('orig-3', '***ANONYMIZED***', 'identity', 'pii');
    m.set('secret-1', '***REDACTED***', 'secrets', 'api-key');
    expect(m.sentinelFanoutCount('***ANONYMIZED***')).toBe(3);
    expect(m.sentinelFanoutCount('***REDACTED***')).toBe(1);
  });

  it('returns zero fanout for an unseen sentinel', () => {
    const m = new BiMap();
    expect(m.sentinelFanoutCount('***ANONYMIZED***')).toBe(0);
  });

  it('counts distinct originals only once even if set is called twice', () => {
    const m = new BiMap();
    m.set('orig-1', '***ANONYMIZED***', 'identity', 'pii');
    m.set('orig-1', '***ANONYMIZED***', 'identity', 'pii');
    expect(m.sentinelFanoutCount('***ANONYMIZED***')).toBe(1);
  });

  it('getByOriginal resolves through sentinel fanout', () => {
    const m = new BiMap();
    m.set('original-1', '***ANONYMIZED***', 'identity', 'x');
    m.set('original-2', '***ANONYMIZED***', 'identity', 'x');
    expect(m.getByOriginal('original-1')).toBe('***ANONYMIZED***');
    expect(m.getByOriginal('original-2')).toBe('***ANONYMIZED***');
  });
});
