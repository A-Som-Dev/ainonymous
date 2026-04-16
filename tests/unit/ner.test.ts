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

    it('detects names inside fenced code blocks (triple backticks are not inline code)', () => {
      // Regression: isInsideCodeBlock counted any backtick in the 50-char
      // window. A ```python fence five lines above the name left 3 single
      // backticks visible in the window, flipping the odd/even check and
      // skipping the hit. Real-world scenario: users paste scripts to Claude
      // wrapped in fenced blocks. those scripts can still carry @author /
      // Maintainer lines with real names.
      const text =
        "Debug this script.\n\n```python\n# debug.py\n# Maintainer: Artur Sommer <a@b.de>\nprint('hi')\n```";
      const hits = detectNames(text);
      expect(hits.some((h) => h.name === 'Artur Sommer')).toBe(true);
    });

    it('detects dict-known name followed by unrelated Capword on next line', () => {
      // Regression: Pass 2 greedy FULL_NAME_RE used to swallow 3 capitalized
      // tokens and reject the match when both ends were unknown dict-wise,
      // causing an inner 2-word pair like "Clemens Kurz" to never be tried.
      const text = 'Reviewers: Person Beta, Clemens Kurz\nCustomer: Deutsche Glasfaser';
      const hits = detectNames(text);
      expect(hits.some((h) => h.name === 'Clemens Kurz')).toBe(true);
    });

    it('does not produce overlapping Pass 2b hits on consecutive CapWord runs', () => {
      const text = 'von Clemens Kurz Peter';
      const hits = detectNames(text);
      const overlap = hits.some((h1, i) =>
        hits.some(
          (h2, j) =>
            i !== j &&
            h1.offset < h2.offset + h2.length &&
            h2.offset < h1.offset + h1.length,
        ),
      );
      expect(overlap).toBe(false);
    });

    it('Pass 2b does not flag pseudonym-shaped tokens ("Person Alpha")', () => {
      const hits = detectNames('Kontakt: Person Alpha');
      expect(hits).toHaveLength(0);
    });

    it('detects names across zero-width-space bypass', () => {
      // `Thomas\u200BMüller` renders as two words but the raw stream is one.
      // Without ZWS-neutralisation Pass 2 would only see the "Thomas" fragment.
      const hits = detectNames('Kontakt: Thomas\u200BMüller');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].name).toContain('Müller');
    });

    it('detects names after fullwidth-prefix bypass', () => {
      // Fullwidth `Ａｕｔｈｏｒ:` NFKC-normalises to `Author:` and triggers Pass 1.
      const hits = detectNames('\uFF21\uFF55\uFF54\uFF48\uFF4F\uFF52: Peter Großmann');
      expect(hits.some((h) => h.name.includes('Großmann'))).toBe(true);
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

  describe('embedded names in camelCase identifiers', () => {
    it('catches camelCase identifiers containing first + last name', () => {
      // Classic data leak: dev names a variable after the person it holds
      // data for. Without this pass the identifier goes straight to the LLM.
      const hits = detectNames('const customerPeterMueller = { salary: 120000 };');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('customerPeterMueller');
    });

    it('catches PascalCase class-like identifiers with embedded names', () => {
      const hits = detectNames('class OrderPatrickSchmidt extends Base {}');
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.some((h) => h.name.includes('Patrick'))).toBe(true);
    });

    it('matches transliterated umlaut surnames (Mueller -> Müller)', () => {
      const hits = detectNames('const dataHansMueller = {};');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('dataHansMueller');
    });

    it('catches snake_case identifiers with embedded names', () => {
      const hits = detectNames('def fetch_artur_sommer_data():');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('fetch_artur_sommer_data');
    });

    it('catches kebab-case identifiers with embedded names', () => {
      const hits = detectNames('function get-hans-weber-record() {}');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('get-hans-weber-record');
    });

    it('does not flag snake_case identifiers where both halves are programming nouns', () => {
      // Regression: Max is a FIRST_NAME (Maximilian diminutive) and Price
      // is a recognised English LAST_NAME, so Pass 3 used to flag every
      // `max_price`, `min_value`, `max_size` etc. as a person-name hit and
      // pseudonymize the dict key / variable name.
      for (const ident of [
        'max_price',
        'MAX_PRICE',
        'user.max_price',
        'config.max_size',
        'item.max_count',
      ]) {
        const hits = detectNames(ident);
        expect(hits, `false positive on ${ident}`).toHaveLength(0);
      }
    });

    it('does not flag plain framework identifiers without a name', () => {
      expect(detectNames('class CustomerServiceRepository {}')).toHaveLength(0);
      expect(detectNames('function processPaymentRequest() {}')).toHaveLength(0);
    });

    it('does not flag single-word identifiers', () => {
      expect(detectNames('let peter = 1;')).toHaveLength(0);
    });
  });

  describe('non-latin names with context prefix', () => {
    it('detects CJK name after Author:', () => {
      const hits = detectNames('Author: 山田太郎 contributed the fix');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('山田太郎');
    });

    it('detects Korean name after Reviewer:', () => {
      const hits = detectNames('Reviewer: 김민수 approved the PR');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('김민수');
    });

    it('detects Arabic name after Kontakt:', () => {
      const hits = detectNames('Kontakt: محمد الحسن ist im Team');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('محمد الحسن');
    });

    it('flags non-latin runs without a prefix at lower confidence', () => {
      const hits = detectNames('山田太郎 wrote this');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('山田太郎');
      // Standalone-non-latin is 0.55; prefix-triggered is 0.9. verify we got
      // the lower tier.
      expect(hits[0].confidence).toBeLessThan(0.7);
    });

    it('catches standalone Arabic name runs', () => {
      const hits = detectNames('محمد الحسن contributed code');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('محمد الحسن');
    });

    it('catches standalone Korean name runs', () => {
      const hits = detectNames('김민수 approved');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('김민수');
    });

    it('catches standalone Cyrillic name runs', () => {
      const hits = detectNames('Контакт: Иван Петров bitte');
      expect(hits.length).toBeGreaterThanOrEqual(1);
    });

    it('catches standalone Hiragana runs', () => {
      const hits = detectNames('さくら contributed');
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('さくら');
    });
  });

  describe('aggression low keeps prefix-triggered names (regression guard)', () => {
    it('still catches Herr Schmidt when skipIdentifierScan=true', () => {
      const hits = detectNames('Herr Schmidt genehmigte das', { skipIdentifierScan: true });
      expect(hits.length).toBe(1);
      expect(hits[0].name).toBe('Schmidt');
    });

    it('still catches multi-word names via FULL_NAME_RE when skipIdentifierScan=true', () => {
      const hits = detectNames('Der Entwickler Maximilian Schneider hat den Bug gemeldet.', {
        skipIdentifierScan: true,
      });
      expect(hits.length).toBeGreaterThan(0);
    });
  });

  describe('tech-suffix tail trimming (prefix pass)', () => {
    it('drops pure tech identifiers after from/by prefix', () => {
      // "Registration" is not a known first name → drops. "Payment" is not
      // either, so "Payment Manager" should drop too even though Pass 2's
      // dictionary match might otherwise grab it.
      expect(detectNames('from Registration Service')).toHaveLength(0);
    });

    it('keeps the person head when only the tail is tech terms', () => {
      // "Hans" is a real first name; "Runner" and "Delta" are both
      // blocklisted tech/pseudonym suffixes. Earlier behaviour dropped the
      // whole match and leaked "Hans" to the LLM. Now the suffixes get
      // stripped and the head is kept.
      const hits = detectNames('Kontakt: Hans Delta Runner');
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].name).toBe('Hans');
    });
  });
});
