import { describe, it, expect, beforeEach } from 'vitest';
import { PseudoGen } from '../../src/pseudo.js';

describe('PseudoGen counter-based types', () => {
  let gen: PseudoGen;

  beforeEach(() => {
    gen = new PseudoGen();
  });

  it('produces unique ipv6 pseudonyms for unique originals', () => {
    const a = gen.ipv6('::1');
    const b = gen.ipv6('2001:db8::cafe');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^2001:db8:/);
    expect(b).toMatch(/^2001:db8:/);
  });

  it('returns same ipv6 pseudonym for same original', () => {
    const a = gen.ipv6('::1');
    const b = gen.ipv6('::1');
    expect(a).toBe(b);
  });

  it('produces unique dateOfBirth pseudonyms', () => {
    const a = gen.dateOfBirth('01.01.1990');
    const b = gen.dateOfBirth('15.08.1976');
    expect(a).not.toBe(b);
  });

  it('produces unique ukNationalInsurance pseudonyms', () => {
    const a = gen.ukNationalInsurance('AB123456C');
    const b = gen.ukNationalInsurance('CD654321A');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-Z]$/);
  });

  it('produces unique mac pseudonyms without wrap at >255', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(gen.mac(`aa:bb:cc:dd:ee:${i.toString(16).padStart(2, '0')}`));
    }
    expect(seen.size).toBe(1000);
  });

  it('produces unique taxId pseudonyms', () => {
    const a = gen.taxId('11/223/45678');
    const b = gen.taxId('22/334/56789');
    expect(a).not.toBe(b);
  });

  it('produces unique nhsNumber pseudonyms', () => {
    const a = gen.nhsNumber('123 456 7890');
    const b = gen.nhsNumber('234 567 8901');
    expect(a).not.toBe(b);
  });

  it('produces unique sozialversicherung pseudonyms', () => {
    const a = gen.sozialversicherung('12 345678 A 123');
    const b = gen.sozialversicherung('98 765432 B 987');
    expect(a).not.toBe(b);
  });

  it('property: 10_000 unique ipv6 originals yield 10_000 unique pseudos', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(gen.ipv6(`fe80::${i.toString(16)}`));
    }
    expect(seen.size).toBe(10_000);
  });

  it('property: 10_000 unique dateOfBirth originals yield 10_000 unique pseudos', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const day = (i % 28) + 1;
      const mon = (Math.floor(i / 28) % 12) + 1;
      const year = 1900 + (i % 120);
      seen.add(gen.dateOfBirth(`${day}.${mon}.${year}-${i}`));
    }
    expect(seen.size).toBe(10_000);
  });

  it('property: 10_000 unique mac originals yield 10_000 unique pseudos', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(gen.mac(`aa:bb:cc:${i.toString(16).padStart(8, '0')}`));
    }
    expect(seen.size).toBe(10_000);
  });
});
