import { describe, it, expect } from 'vitest';
import { detectNames } from '../../src/patterns/ner.js';

describe('NER name detection', () => {
  describe('German names without config', () => {
    it('detects full German names in prose', () => {
      const text = 'Der Entwickler Maximilian Schneider hat den Bug gemeldet.';
      const hits = detectNames(text);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].name).toContain('Schneider');
    });

    it('detects names with title prefix', () => {
      const text = 'Herr Müller hat das Ticket erstellt.';
      const hits = detectNames(text);
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('Müller');
      expect(hits[0].confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects Dr. prefix names', () => {
      const text = 'Ergebnis von Dr. Maria Weber';
      const hits = detectNames(text);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.name.includes('Weber'))).toBe(true);
    });

    it('detects common German name pairs', () => {
      const pairs = [
        'Thomas Müller',
        'Stefan Schmidt',
        'Michael Fischer',
        'Julia Wagner',
        'Katharina Hoffmann',
        'Anna Becker',
      ];
      for (const pair of pairs) {
        const hits = detectNames(`Kontakt: ${pair} im Büro`);
        expect(hits.length, `should detect "${pair}"`).toBeGreaterThan(0);
        expect(hits[0].name).toBe(pair);
      }
    });

    it('detects names with known first + unknown last name', () => {
      const text = 'Bericht von Tobias Grünwald eingereicht';
      const hits = detectNames(text);
      expect(hits.length).toBeGreaterThan(0);
      // Grünwald ends with -wald suffix
      expect(hits[0].name).toContain('Grünwald');
    });
  });

  describe('names in code comments', () => {
    it('detects Author annotations', () => {
      const text = '// Author: Dr. Maria Weber\n// Reviewer: Thomas Müller';
      const hits = detectNames(text);
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    it('detects @author JavaDoc tags', () => {
      const text = '/** @author Stefan Schneider */';
      const hits = detectNames(text);
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('Stefan Schneider');
    });

    it('detects Signed-off-by in commit messages', () => {
      const text = 'Signed-off-by: Katharina Fischer';
      const hits = detectNames(text);
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('Katharina Fischer');
    });

    it('detects "Erstellt von" marker', () => {
      const text = 'Erstellt von: Julia Hartmann';
      const hits = detectNames(text);
      expect(hits.length).toBe(1);
      expect(hits[0].name).toContain('Hartmann');
    });
  });

  describe('false positive suppression', () => {
    it('does not flag programming terms as names', () => {
      const text = 'class ServiceHandler { private final String value; }';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag class definitions', () => {
      const text = 'export class UserController extends BaseService {}';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag camelCase identifiers', () => {
      const text = 'const firstName = getUserName();';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag technology names', () => {
      const text = 'We use Spring Boot with Docker and Kubernetes.';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag backtick-quoted code', () => {
      const text = 'Run `Thomas Schmidt` as module name';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag German nouns at sentence start', () => {
      const text = 'Fehler beim Laden der Konfiguration.';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag method calls', () => {
      const text = 'Michael.parse() returns the result';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag single capitalized words without context', () => {
      const text = 'The Parser handles all inputs.';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });

    it('does not flag generic class-like patterns', () => {
      const text = 'function DataLoader<Config>(input: string): void {}';
      const hits = detectNames(text);
      expect(hits).toHaveLength(0);
    });
  });

  describe('international names', () => {
    it('detects Turkish names', () => {
      const hits = detectNames('Author: Mehmet Yılmaz reviewed the code');
      const names = hits.map((h) => h.name);
      expect(names).toContain('Mehmet Yılmaz');
    });

    it('detects Arabic names', () => {
      const hits = detectNames('Contact: Mohammed Al-Rahman for support');
      const names = hits.map((h) => h.name);
      expect(names).toContain('Mohammed Al-Rahman');
    });

    it('detects Polish names', () => {
      const hits = detectNames('Developer: Krzysztof Kowalski');
      const names = hits.map((h) => h.name);
      expect(names).toContain('Krzysztof Kowalski');
    });

    it('detects Italian names', () => {
      const hits = detectNames('Reviewer: Giuseppe Esposito fixed the issue');
      const names = hits.map((h) => h.name);
      expect(names).toContain('Giuseppe Esposito');
    });

    it('detects Indian names', () => {
      const hits = detectNames('Signed-off-by: Rajesh Sharma');
      const names = hits.map((h) => h.name);
      expect(names).toContain('Rajesh Sharma');
    });

    it('detects Turkish names with special chars (ş, ı, ğ, ö, ü)', () => {
      const hits = detectNames('Herr Öztürk hat den Code geprüft.');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].name).toBe('Öztürk');
    });

    it('detects Polish names with special chars (ł, ą, ę)', () => {
      const hits = detectNames('Author: Łukasz Dąbrowski committed the fix');
      const names = hits.map((h) => h.name);
      expect(names).toContain('Łukasz Dąbrowski');
    });

    it('detects Arabic compound last names with Al- prefix', () => {
      const hits = detectNames('Author: Ahmed Al-Hassan reviewed it');
      const names = hits.map((h) => h.name);
      expect(names).toContain('Ahmed Al-Hassan');
    });

    it('does not create false positives for common international words', () => {
      const hits = detectNames('The service runs on port 8080.');
      expect(hits).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty for empty string', () => {
      expect(detectNames('')).toHaveLength(0);
    });

    it('returns empty for plain lowercase text', () => {
      expect(detectNames('nothing to see here folks')).toHaveLength(0);
    });

    it('handles multiple names in one text', () => {
      const text = 'Teilnehmer: Sebastian Richter, Claudia Hoffmann und Martin Schulz';
      const hits = detectNames(text);
      expect(hits.length).toBeGreaterThanOrEqual(3);
    });

    it('provides correct offset and length', () => {
      const text = 'Kontakt: Stefan Weber bitte anrufen';
      const hits = detectNames(text);
      expect(hits.length).toBe(1);
      expect(text.slice(hits[0].offset, hits[0].offset + hits[0].length)).toBe('Stefan Weber');
    });

    it('detects names with Frau prefix', () => {
      const text = 'Frau Schneider hat zugestimmt.';
      const hits = detectNames(text);
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('Schneider');
    });
  });
});
