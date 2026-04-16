import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { BiMap } from '../../src/session/map.js';

describe('BiMap', () => {
  let map: BiMap;

  beforeEach(() => {
    map = new BiMap();
  });

  it('stores and retrieves by original', () => {
    map.set('CustomerService', 'AlphaService', 'code', 'class-name');
    expect(map.getByOriginal('CustomerService')).toBe('AlphaService');
  });

  it('retrieves by pseudonym (reverse lookup)', () => {
    map.set('artur@asom.de', 'user1@alpha.de', 'identity', 'email');
    expect(map.getByPseudonym('user1@alpha.de')).toBe('artur@asom.de');
  });

  it('returns undefined for unknown keys', () => {
    expect(map.getByOriginal('nope')).toBeUndefined();
    expect(map.getByPseudonym('nope')).toBeUndefined();
  });

  it('returns same pseudonym for repeated sets', () => {
    map.set('Customer', 'Alpha', 'code', 'domain-term');
    map.set('Customer', 'Alpha', 'code', 'domain-term');
    expect(map.size).toBe(1);
  });

  it('tracks size correctly', () => {
    map.set('a', 'x', 'identity', 'test');
    map.set('b', 'y', 'identity', 'test');
    expect(map.size).toBe(2);
  });

  it('iterates all entries', () => {
    map.set('a', 'x', 'identity', 'test');
    map.set('b', 'y', 'code', 'test');
    const entries = [...map.entries()];
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(['a', 'x']);
  });

  it('clears everything', () => {
    map.set('a', 'x', 'identity', 'test');
    map.clear();
    expect(map.size).toBe(0);
    expect(map.getByOriginal('a')).toBeUndefined();
  });

  it('keeps metadata for audit', () => {
    map.set('192.168.1.1', '10.0.0.1', 'identity', 'ip');
    const meta = map.getMeta('192.168.1.1');
    expect(meta?.layer).toBe('identity');
    expect(meta?.type).toBe('ip');
  });

  it('does not store originals in cleartext internally', () => {
    const original = 'artur.wolf@company.de';
    map.set(original, 'user1@anon.de', 'identity', 'email');

    // Access internal maps via casting to check raw storage
    const internals = map as any;
    const fwdKeys = [...internals.fwd.keys()];
    const fwdValues = [...internals.fwd.values()];
    const revKeys = [...internals.rev.keys()];
    const metaKeys = [...internals.meta.keys()];

    // Forward map keys are hashed, not cleartext
    expect(fwdKeys).not.toContain(original);
    // Forward map values are pseudonyms (fine to be cleartext)
    expect(fwdValues).toContain('user1@anon.de');
    // Reverse map keys are pseudonyms, values are encrypted objects
    expect(revKeys).toContain('user1@anon.de');
    const revValue = internals.rev.get('user1@anon.de');
    expect(revValue).toHaveProperty('iv');
    expect(revValue).toHaveProperty('data');
    expect(revValue).toHaveProperty('tag');
    expect(revValue.data.toString('utf8')).not.toBe(original);
    // Meta keys are hashed too
    expect(metaKeys).not.toContain(original);
  });

  it('rotates encryption key on clear', () => {
    map.set('secret', 'pseudo', 'identity', 'test');
    const keyBefore = Buffer.from((map as any).key);
    map.clear();
    const keyAfter = Buffer.from((map as any).key);
    expect(keyBefore.equals(keyAfter)).toBe(false);
  });

  it('reports the longest pseudonym length', () => {
    expect(map.getMaxPseudonymLength()).toBe(0);
    map.set('a', 'X', 'identity', 'test');
    map.set('b', 'Yabcd', 'identity', 'test');
    map.set('c', 'ZZZ', 'identity', 'test');
    expect(map.getMaxPseudonymLength()).toBe(5);
  });

  it('produces different ciphertexts across instances', () => {
    const other = new BiMap();
    const original = 'SensitiveClassName';

    map.set(original, 'AlphaClass', 'code', 'class-name');
    other.set(original, 'AlphaClass', 'code', 'class-name');

    const revA = (map as any).rev.get('AlphaClass');
    const revB = (other as any).rev.get('AlphaClass');

    // Different keys and IVs mean different ciphertext
    expect(revA.data.equals(revB.data)).toBe(false);
  });

  describe('decrypt cache', () => {
    it('invalidates cache on set', () => {
      map.set('a', 'A', 'identity', 'test');
      void [...map.entries()];
      expect((map as any).decryptedCache).not.toBeNull();

      map.set('b', 'B', 'identity', 'test');
      expect((map as any).decryptedCache).toBeNull();

      expect(map.getByPseudonym('B')).toBe('b');
      expect(map.getByPseudonym('A')).toBe('a');
      const all = [...map.entries()];
      expect(all).toContainEqual(['a', 'A']);
      expect(all).toContainEqual(['b', 'B']);
    });

    it('invalidates cache on clear', () => {
      map.set('a', 'A', 'identity', 'test');
      void [...map.entries()];
      expect((map as any).decryptedCache).not.toBeNull();

      map.clear();
      expect((map as any).decryptedCache).toBeNull();
      expect([...map.entries()]).toHaveLength(0);
    });

    it('invalidates cache on rotateKey', () => {
      map.set('a', 'A', 'identity', 'test');
      void [...map.entries()];
      expect((map as any).decryptedCache).not.toBeNull();

      map.rotateKey(randomBytes(32));
      expect((map as any).decryptedCache).toBeNull();
      expect(map.getByPseudonym('A')).toBe('a');
    });

    it('stays correct across 1000 sets and 100 iterations', () => {
      for (let i = 0; i < 1000; i++) {
        map.set(`orig-${i}`, `pseudo-${i}`, 'identity', 'test');
      }
      for (let iter = 0; iter < 100; iter++) {
        const all = [...map.entries()];
        expect(all).toHaveLength(1000);
      }
      for (let i = 0; i < 1000; i++) {
        expect(map.getByPseudonym(`pseudo-${i}`)).toBe(`orig-${i}`);
      }
    });

    it('keeps entries() and getByPseudonym() in sync after re-populate', () => {
      map.set('foo', 'Alpha', 'identity', 'test');
      expect(map.getByPseudonym('Alpha')).toBe('foo');
      map.set('bar', 'Beta', 'identity', 'test');
      const all = [...map.entries()];
      expect(all).toContainEqual(['foo', 'Alpha']);
      expect(all).toContainEqual(['bar', 'Beta']);
    });

    it('iterating 100x over 500 entries stays fast (regression)', () => {
      for (let i = 0; i < 500; i++) {
        map.set(`original-value-${i}`, `pseudo-${i}`, 'identity', 'test');
      }
      const start = Date.now();
      for (let iter = 0; iter < 100; iter++) {
        const all = [...map.entries()];
        if (all.length !== 500) throw new Error('size drift');
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });
});
