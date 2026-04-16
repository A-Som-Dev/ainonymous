import { splitIdentifier, STRUCTURAL_SUFFIXES } from '../shared.js';

const MIN_TERM_LENGTH = 3;

export class GlossaryManager {
  private domain: Set<string>;
  private preserved: Set<string>;

  constructor(domainTerms: string[], preserveTerms: string[]) {
    this.domain = new Set(domainTerms);
    this.preserved = new Set(preserveTerms);
  }

  isDomainTerm(term: string): boolean {
    return this.domain.has(term);
  }

  isPreserved(term: string): boolean {
    return this.preserved.has(term);
  }

  addDomainTerm(term: string): void {
    this.domain.add(term);
  }

  addPreserved(term: string): void {
    this.preserved.add(term);
  }

  get domainTerms(): string[] {
    return [...this.domain];
  }

  suggest(identifiers: string[]): string[] {
    const seen = new Set<string>();

    for (const id of identifiers) {
      const parts = splitIdentifier(id);
      for (const part of parts) {
        if (part.length < MIN_TERM_LENGTH) continue;
        if (this.domain.has(part)) continue;
        if (this.preserved.has(part)) continue;
        if (STRUCTURAL_SUFFIXES.has(part.toLowerCase())) continue;
        seen.add(part);
      }
    }

    return [...seen].sort();
  }
}
