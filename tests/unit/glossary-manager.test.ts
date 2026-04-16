import { describe, it, expect, beforeEach } from 'vitest';
import { GlossaryManager } from '../../src/glossary/manager.js';

describe('GlossaryManager', () => {
  let mgr: GlossaryManager;

  beforeEach(() => {
    mgr = new GlossaryManager(['Customer', 'Order', 'Invoice'], ['Express', 'Prisma']);
  });

  it('checks if a term is a domain term', () => {
    expect(mgr.isDomainTerm('Customer')).toBe(true);
    expect(mgr.isDomainTerm('Express')).toBe(false);
  });

  it('checks if a term is preserved', () => {
    expect(mgr.isPreserved('Express')).toBe(true);
    expect(mgr.isPreserved('Customer')).toBe(false);
  });

  it('adds new domain terms', () => {
    mgr.addDomainTerm('Payment');
    expect(mgr.isDomainTerm('Payment')).toBe(true);
  });

  it('suggests terms from identifiers', () => {
    const ids = ['CustomerService', 'OrderRepository', 'ExpressRouter', 'PaymentGateway'];
    const suggestions = mgr.suggest(ids);
    expect(suggestions).toContain('Payment');
    expect(suggestions).not.toContain('Customer');
    expect(suggestions).not.toContain('Express');
  });

  it('returns domain terms list', () => {
    expect(mgr.domainTerms).toContain('Customer');
    expect(mgr.domainTerms).toHaveLength(3);
  });
});
