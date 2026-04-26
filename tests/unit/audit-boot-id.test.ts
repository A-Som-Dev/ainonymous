import { describe, it, expect } from 'vitest';
import { getBootId } from '../../src/audit/boot-id.js';

describe('getBootId', () => {
  it('returns either a non-empty string or null on every platform', () => {
    const id = getBootId();
    if (id !== null) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(96);
      expect(id).toMatch(/^linux:/);
    }
  });

  it('returns the same value on repeated calls within a boot session', () => {
    const a = getBootId();
    const b = getBootId();
    expect(a).toBe(b);
  });
});
