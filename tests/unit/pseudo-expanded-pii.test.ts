import { describe, it, expect, beforeEach } from 'vitest';
import { PseudoGen } from '../../src/pseudo.js';

describe('PseudoGen expanded PII generators', () => {
  let gen: PseudoGen;

  beforeEach(() => {
    gen = new PseudoGen();
  });

  it('ssn: distinct inputs get distinct pseudos, format NNN-NN-NNNN', () => {
    const a = gen.ssn('123-45-6789');
    const b = gen.ssn('987-65-4321');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{3}-\d{2}-\d{4}$/);
    expect(gen.ssn('123-45-6789')).toBe(a);
  });

  it('zip-code-us: 5-digit format', () => {
    const a = gen.zipCodeUs('10001');
    const b = gen.zipCodeUs('90210');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{5}$/);
  });

  it('passport-us: 9 digits', () => {
    const a = gen.passportUs('A12345678');
    const b = gen.passportUs('B98765432');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{9}$/);
  });

  it('passport-uk: 9 digits', () => {
    const a = gen.passportUk('123456789');
    const b = gen.passportUk('987654321');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{9}$/);
  });

  it('driving-license-us: placeholder format', () => {
    const a = gen.drivingLicenseUs('D1234567');
    const b = gen.drivingLicenseUs('X9876543');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^D\d{7,}$/);
  });

  it('driving-license-uk: 16 chars', () => {
    const a = gen.drivingLicenseUk('MORGA123456AB7CD');
    const b = gen.drivingLicenseUk('SMITH654321XY8ZW');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z0-9]{16}$/);
  });

  it('postcode-uk: format AA0 0AA', () => {
    const a = gen.postcodeUk('SW1A 1AA');
    const b = gen.postcodeUk('EC1V 9HF');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z]{2}\d\s\d[A-Z]{2}$/);
  });

  it('canadian-sin: 9 digits grouped', () => {
    const a = gen.canadianSin('123 456 789');
    const b = gen.canadianSin('987 654 321');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{3}\s\d{3}\s\d{3}$/);
  });

  it('australian-tfn: 9 digits', () => {
    const a = gen.australianTfn('123 456 782');
    const b = gen.australianTfn('987 654 321');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{3}\s\d{3}\s\d{3}$/);
  });

  it('australian-medicare: 10 digits', () => {
    const a = gen.australianMedicare('2123 45678 1');
    const b = gen.australianMedicare('3987 65432 1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{10}$/);
  });

  it('india-aadhaar: 12 digits grouped', () => {
    const a = gen.indiaAadhaar('1234 5678 9012');
    const b = gen.indiaAadhaar('9876 5432 1098');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{4}\s\d{4}\s\d{4}$/);
  });

  it('india-pan: format AAAAA0000A', () => {
    const a = gen.indiaPan('ABCDE1234F');
    const b = gen.indiaPan('ZYXWV9876A');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z]{5}\d{4}[A-Z]$/);
  });

  it('brazilian-cpf: 11 digits grouped', () => {
    const a = gen.brazilianCpf('123.456.789-00');
    const b = gen.brazilianCpf('987.654.321-99');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  });

  it('brazilian-cnpj: 14 digits grouped', () => {
    const a = gen.brazilianCnpj('12.345.678/0001-00');
    const b = gen.brazilianCnpj('98.765.432/0001-99');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
  });

  it('mexican-curp: 18 chars', () => {
    const a = gen.mexicanCurp('ABCD123456HDFXYZ01');
    const b = gen.mexicanCurp('ZYXW987654MDFABC02');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z0-9]{18}$/);
  });

  it('mexican-rfc: 13 chars', () => {
    const a = gen.mexicanRfc('ABCD850612123');
    const b = gen.mexicanRfc('ZYXW760903987');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z0-9]{13}$/);
  });

  it('south-korean-rrn: format 000000-NNNNNNN', () => {
    const a = gen.southKoreanRrn('880220-1234567');
    const b = gen.southKoreanRrn('901015-2345678');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{6}-\d{7}$/);
  });

  it('south-africa-id: 13 digits', () => {
    const a = gen.southAfricaId('8001015009087');
    const b = gen.southAfricaId('7606233456780');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{13}$/);
  });

  it('hungarian-tax-id: 10 digits', () => {
    const a = gen.hungarianTaxId('8123456789');
    const b = gen.hungarianTaxId('8987654321');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{10}$/);
  });

  it('hungarian-personal-id: 11 digits', () => {
    const a = gen.hungarianPersonalId('12345678901');
    const b = gen.hungarianPersonalId('98765432109');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{11}$/);
  });

  it('indonesia-nik: 16 digits', () => {
    const a = gen.indonesiaNik('3201012505900001');
    const b = gen.indonesiaNik('3374056012920002');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{16}$/);
  });

  it('property: 1000 unique ssn inputs stay unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(gen.ssn(`ssn-${i}`));
    expect(seen.size).toBe(1000);
  });

  it('property: 1000 unique india-aadhaar inputs stay unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(gen.indiaAadhaar(`aad-${i}`));
    expect(seen.size).toBe(1000);
  });
});
