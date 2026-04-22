import { describe, it, expect } from 'vitest';
import { PseudoGen } from '../../src/pseudo.js';

describe('PseudoGen identity-map no-op protection', () => {
  it('skips a greek pseudo that would equal its original identifier', () => {
    const pg = new PseudoGen();
    const pseudo = pg.identifier('Alpha');
    expect(pseudo).not.toBe('Alpha');
  });

  it('skips a person pseudo that would equal the original name', () => {
    const pg = new PseudoGen();
    const pseudo = pg.person('Person Alpha');
    expect(pseudo).not.toBe('Person Alpha');
  });

  it('each identity-map skip is tracked on the generator', () => {
    const pg = new PseudoGen();
    pg.identifier('Alpha');
    expect(pg.identityMapSkips()).toBeGreaterThan(0);
  });

  it('seedCounter respects the 1-based start so two seeded generators do not collide', () => {
    const a = new PseudoGen();
    a.seedCounter('identifier', 1);
    const aFirst = a.identifier('orig-a-0');

    const b = new PseudoGen();
    b.seedCounter('identifier', 2);
    const bFirst = b.identifier('orig-b-0');

    expect(aFirst).not.toBe(bFirst);
  });
});
