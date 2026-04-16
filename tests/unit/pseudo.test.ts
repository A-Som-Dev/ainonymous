import { describe, it, expect, beforeEach } from 'vitest';
import { PseudoGen } from '../../src/pseudo.js';

describe('PseudoGen', () => {
  let gen: PseudoGen;

  beforeEach(() => {
    gen = new PseudoGen();
  });

  it('generates email pseudonyms', () => {
    const p = gen.email('artur@asom.de');
    expect(p).toMatch(/^user\d+@company-[a-z]+\.\w+$/);
  });

  it('returns same pseudonym for same email', () => {
    const a = gen.email('test@example.com');
    const b = gen.email('test@example.com');
    expect(a).toBe(b);
  });

  it('generates different pseudonyms for different emails', () => {
    const a = gen.email('a@example.com');
    const b = gen.email('b@example.com');
    expect(a).not.toBe(b);
  });

  it('generates IP pseudonyms in valid format', () => {
    const p = gen.ipv4('192.168.1.50');
    expect(p).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });

  it('generates domain pseudonyms', () => {
    const p = gen.domain('asom.internal');
    expect(p).toMatch(/^[a-z]+-corp\.\w+$/);
  });

  it('generates person name pseudonyms', () => {
    const p = gen.person('Artur Sommer');
    expect(p).toMatch(/^Person [A-Z][a-z]+$/);
  });

  it('generates code identifier pseudonyms', () => {
    const p = gen.identifier('Customer');
    expect(p).toMatch(/^[A-Z][a-z]+$/);
  });

  it('uses greek alphabet for identifiers', () => {
    const first = gen.identifier('Customer');
    const second = gen.identifier('Order');
    expect(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']).toContain(first);
    expect(first).not.toBe(second);
  });

  it('resets counter on clear', () => {
    gen.identifier('Foo');
    gen.clear();
    const p = gen.identifier('Bar');
    expect(p).toBe('Alpha');
  });
});
