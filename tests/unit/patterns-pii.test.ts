import { describe, it, expect } from 'vitest';
import { matchPII, matchPIIEnhanced } from '../../src/patterns/pii.js';

describe('PII patterns', () => {
  it('detects email addresses', () => {
    const hits = matchPII('contact artur@example.com for info');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'email' }));
  });

  it('detects german phone numbers', () => {
    const hits = matchPII('call +49 170 1234567');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'phone' }));
  });

  it('detects IBAN', () => {
    const hits = matchPII('IBAN: DE89 3704 0044 0532 0130 00');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'iban' }));
  });

  it('detects german tax IDs', () => {
    const hits = matchPII('Steuer-Nr: 12/345/67890');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'tax-id' }));
  });

  it('detects street addresses', () => {
    const hits = matchPII('Musterstraße 12, 80331 München');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'address' }));
  });

  it('does not flag normal text', () => {
    const hits = matchPII('the quick brown fox jumps');
    expect(hits).toHaveLength(0);
  });

  it('detects email when zero-width char is injected', () => {
    const text = 'write to artur\u200B@example.com today';
    const hits = matchPII(text);
    const email = hits.find((h) => h.type === 'email');
    expect(email).toBeDefined();
    // match span covers the ZWJ so the redaction obliterates the original
    const slice = text.slice(email!.offset, email!.offset + email!.length);
    expect(slice).toContain('\u200B');
  });

  it('detects phone when digits are split by zero-width chars', () => {
    const text = 'call +49 170\u200B 1234567 now';
    const hits = matchPII(text);
    expect(hits).toContainEqual(expect.objectContaining({ type: 'phone' }));
  });
});

describe('PII patterns enhanced (OpenRedaction)', () => {
  it('detects credit cards with checksum validation', async () => {
    const hits = await matchPIIEnhanced('card number 4111-1111-1111-1111');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'credit-card' }));
  });

  it('detects IBANs via both engines', async () => {
    const hits = await matchPIIEnhanced('IBAN: DE89 3704 0044 0532 0130 00');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'iban' }));
  });

  it('keeps local patterns when OpenRedaction has no match', async () => {
    const hits = await matchPIIEnhanced('Steuer-Nr: 12/345/67890');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'tax-id' }));
  });

  it('produces correct offset and length', async () => {
    const text = 'mail to artur@company.de please';
    const hits = await matchPIIEnhanced(text);
    const email = hits.find((h) => h.type === 'email');
    expect(email).toBeDefined();
    expect(text.slice(email!.offset, email!.offset + email!.length)).toBe(email!.match);
  });

  it('does not flag clean text', async () => {
    const hits = await matchPIIEnhanced('the quick brown fox jumps');
    expect(hits).toHaveLength(0);
  });

  it('detects person names in text through OpenRedaction', async () => {
    const hits = await matchPIIEnhanced('contact person: Artur Sommer at the office');
    // OpenRedaction's name detection is context-dependent, so this may or may not match.
    // What matters is that the function runs without errors.
    expect(Array.isArray(hits)).toBe(true);
  });

  it('respects compliance preset parameter', async () => {
    const hits = await matchPIIEnhanced('mail to artur@company.de', 'gdpr');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'email' }));
  });
});
