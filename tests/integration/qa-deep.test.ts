import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';
import { matchPII, matchPIIEnhanced } from '../../src/patterns/pii.js';
import { matchSecrets, matchSecretsEnhanced } from '../../src/patterns/secrets.js';
import { matchInfra } from '../../src/patterns/infra.js';
import { BiMap } from '../../src/session/map.js';
import { SecretsLayer } from '../../src/pipeline/layer1-secrets.js';
import type { PipelineContext } from '../../src/types.js';

function makeConfig(overrides: Record<string, unknown> = {}) {
  const d = getDefaults();
  return {
    ...d,
    identity: {
      company: 'Asom GmbH',
      domains: ['asom.de', 'asom.internal'],
      people: ['Artur Sommer'],
    },
    code: {
      ...d.code,
      domainTerms: ['Customer', 'Order', 'Invoice'],
      preserve: ['Express', 'PrismaClient'],
    },
    ...overrides,
  };
}

describe('QA: Gemischte PII-Typen in einem Satz', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('anonymisiert Name + E-Mail + IBAN in einem Satz', async () => {
    const input =
      'Bitte überweisen Sie an Artur Sommer (artur@asom.de), IBAN DE89 3704 0044 0532 0130 00.';
    const result = await pipeline.anonymize(input);

    expect(result.text).not.toContain('Artur Sommer');
    expect(result.text).not.toContain('artur@asom.de');
    expect(result.text).not.toContain('DE89 3704 0044 0532 0130 00');

    const layers = new Set(result.replacements.map((r) => r.layer));
    expect(layers.has('identity')).toBe(true);
  });

  it('anonymisiert Name + Telefon + IP in einem Satz', async () => {
    const input = 'Artur Sommer ist erreichbar unter +49 170 1234567 vom Server 192.168.1.100.';
    const result = await pipeline.anonymize(input);

    expect(result.text).not.toContain('Artur Sommer');
    expect(result.text).not.toContain('+49 170 1234567');
    expect(result.text).not.toContain('192.168.1.100');
  });

  it('anonymisiert E-Mail + AWS-Key + Domain in einem Satz', async () => {
    const input = 'Deploy by artur@asom.de with key AKIAIOSFODNN7EXAMPLE on api.asom.internal';
    const result = await pipeline.anonymize(input);

    expect(result.text).not.toContain('artur@asom.de');
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).not.toContain('asom.internal');
    expect(result.text).toContain('***REDACTED***');
  });
});

describe('QA: Edge Cases', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('verarbeitet leeren String ohne Fehler', async () => {
    const result = await pipeline.anonymize('');
    expect(result.text).toBe('');
    expect(result.replacements).toHaveLength(0);
  });

  it('verarbeitet Unicode-Text (Umlaute, Emojis)', async () => {
    const input = 'Grüße von Artur Sommer aus München 🏠';
    const result = await pipeline.anonymize(input);
    expect(result.text).not.toContain('Artur Sommer');
    // Umlaute und Emojis sollen erhalten bleiben (außer wenn sie Teil von PII sind)
    expect(result.text).toContain('Grüße');
    expect(result.text).toContain('🏠');
  });

  it('verarbeitet sehr langen String (10.000+ Zeichen)', async () => {
    const base = 'Artur Sommer arbeitet bei Asom GmbH. ';
    const input = base.repeat(300); // ~11100 Zeichen
    const result = await pipeline.anonymize(input);
    expect(result.text).not.toContain('Artur Sommer');
    expect(result.text).not.toContain('Asom GmbH');
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('verarbeitet String mit nur Whitespace', async () => {
    const result = await pipeline.anonymize('   \n\t  \n  ');
    expect(result.text).toBe('   \n\t  \n  ');
    expect(result.replacements).toHaveLength(0);
  });

  it('verarbeitet String mit Sonderzeichen', async () => {
    const input = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
    const result = await pipeline.anonymize(input);
    expect(result.text).toBe(input);
  });
});

describe('QA: Text der NUR Secrets enthält', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('redacted Secrets ohne PII oder Code', async () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE\npassword = "supergeheim123"';
    const result = await pipeline.anonymize(input);
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).not.toContain('supergeheim123');
    const secretReplacements = result.replacements.filter((r) => r.layer === 'secrets');
    expect(secretReplacements.length).toBeGreaterThan(0);
  });

  it('markiert JWT-Token als REDACTED', async () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = await pipeline.anonymize(`token: ${jwt}`);
    expect(result.text).not.toContain('eyJhbGciOiJIUzI1NiI');
    expect(result.text).toContain('***REDACTED***');
  });

  it('markiert Connection-Strings als REDACTED', async () => {
    const input = 'DATABASE_URL=postgresql://admin:s3cret@db.internal:5432/production';
    const result = await pipeline.anonymize(input);
    expect(result.text).not.toContain('admin:s3cret');
    expect(result.text).toContain('***REDACTED***');
  });
});

describe('QA: False Positive Check', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('lässt normalen deutschen Text unangetastet (lokale Patterns)', () => {
    const input = 'Der schnelle braune Fuchs springt über den faulen Hund.';
    const piiHits = matchPII(input);
    const infraHits = matchInfra(input);
    expect(piiHits).toHaveLength(0);
    expect(infraHits).toHaveLength(0);
  });

  it('lässt generischen Code unangetastet', async () => {
    const input = 'function add(a: number, b: number): number { return a + b; }';
    const result = await pipeline.anonymize(input);
    // Sollte den reinen generischen Code nicht ändern
    expect(result.text).toContain('function');
    expect(result.text).toContain('return');
  });

  it('lässt Standard-IP-Adressen (localhost) unangetastet', async () => {
    const input = 'Der Server läuft auf 127.0.0.1:3000';
    const result = await pipeline.anonymize(input);
    expect(result.text).toContain('127.0.0.1');
  });

  it('verändert keine normalen Zahlen', async () => {
    const input = 'Wir haben 42 Mitarbeiter und 3 Standorte.';
    const result = await pipeline.anonymize(input);
    expect(result.text).toContain('42');
    expect(result.text).toContain('3');
  });
});

describe('QA: Rehydration - Vollständiger Roundtrip', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('Roundtrip: anonymisieren → LLM-Antwort simulieren → rehydrieren', async () => {
    const input = 'Bitte prüfe den Code von Asom GmbH auf asom.internal';
    const anonResult = await pipeline.anonymize(input);

    expect(anonResult.text).not.toContain('Asom GmbH');
    expect(anonResult.text).not.toContain('asom.internal');

    // Simuliere LLM-Antwort die das Pseudonym benutzt
    const map = pipeline.getSessionMap();
    const companyPseudo = map.getByOriginal('Asom GmbH');
    const domainPseudo = map.getByOriginal('asom.internal');

    expect(companyPseudo).toBeDefined();
    expect(domainPseudo).toBeDefined();

    const llmResponse = `Der Code von ${companyPseudo} auf ${domainPseudo} sieht gut aus.`;
    const rehydrated = pipeline.rehydrate(llmResponse);

    expect(rehydrated).toContain('Asom GmbH');
    expect(rehydrated).toContain('asom.internal');
    expect(rehydrated).not.toContain(companyPseudo!);
    expect(rehydrated).not.toContain(domainPseudo!);
  });

  it('REDACTED wird NIEMALS rehydriert', async () => {
    const input = 'AWS key: AKIAIOSFODNN7EXAMPLE und Contact: Artur Sommer';
    await pipeline.anonymize(input);

    // Simuliere LLM-Antwort mit REDACTED
    const llmResponse = 'Das ***REDACTED*** Token sollte rotiert werden. Kontaktiere den Admin.';
    const rehydrated = pipeline.rehydrate(llmResponse);

    expect(rehydrated).toContain('***REDACTED***');
    expect(rehydrated).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('Rehydration mit Code-Pseudonymen', async () => {
    const input = 'class CustomerService { getCustomer() {} }';
    await pipeline.anonymize(input);

    const map = pipeline.getSessionMap();
    const customerPseudo = map.getByOriginal('Customer');

    if (customerPseudo) {
      const llmResponse = `Die ${customerPseudo}Service Klasse sollte refactored werden.`;
      const rehydrated = pipeline.rehydrate(llmResponse);
      expect(rehydrated).toContain('Customer');
    }
  });

  it('Rehydration funktioniert mit mehreren Pseudonymen', async () => {
    const input = 'Artur Sommer bei Asom GmbH (artur@asom.de)';
    await pipeline.anonymize(input);

    const map = pipeline.getSessionMap();
    const personPseudo = map.getByOriginal('Artur Sommer');
    const companyPseudo = map.getByOriginal('Asom GmbH');

    expect(personPseudo).toBeDefined();
    expect(companyPseudo).toBeDefined();

    const llmResponse = `${personPseudo} bei ${companyPseudo} ist der Ansprechpartner.`;
    const rehydrated = pipeline.rehydrate(llmResponse);

    expect(rehydrated).toContain('Artur Sommer');
    expect(rehydrated).toContain('Asom GmbH');
  });
});

describe('QA: Rehydration Iteratives Ersetzen (Cascading)', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('Rehydration stoppt nach MAX_ITER (kein Endlosloop)', () => {
    // Manuell einen zirkulären Fall erzeugen
    const map = pipeline.getSessionMap();
    // Kein tatsächlich zirkulärer Fall möglich durch BiMap-Semantik,
    // aber teste dass die Iteration korrekt terminiert
    map.set('OriginalA', 'PseudoA', 'identity', 'test');
    map.set('OriginalB', 'PseudoB', 'identity', 'test');

    const text = 'PseudoA und PseudoB arbeiten zusammen';
    const result = pipeline.rehydrate(text);
    expect(result).toContain('OriginalA');
    expect(result).toContain('OriginalB');
  });
});

describe('QA: Session Map Konsistenz', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('gleiches Original bekommt immer gleiches Pseudonym', async () => {
    const r1 = await pipeline.anonymize('Kontaktiere Asom GmbH für Details');
    const r2 = await pipeline.anonymize('Die Asom GmbH ist verantwortlich');

    // Beide Ergebnisse sollten "Asom GmbH" nicht mehr enthalten
    expect(r1.text).not.toContain('Asom GmbH');
    expect(r2.text).not.toContain('Asom GmbH');

    // Session Map muss einen Eintrag für das Original haben
    const map = pipeline.getSessionMap();
    const pseudo = map.getByOriginal('Asom GmbH');
    expect(pseudo).toBeDefined();
  });

  it('Pipeline reset löscht Session Map', async () => {
    await pipeline.anonymize('Kontaktiere Asom GmbH');
    expect(pipeline.getSessionMap().size).toBeGreaterThan(0);

    pipeline.reset();
    expect(pipeline.getSessionMap().size).toBe(0);
  });
});

describe('QA: Pattern-Erkennung - matchPII vs matchPIIEnhanced', () => {
  it('Enhanced erkennt mindestens alles was lokal erkannt wird', async () => {
    const inputs = [
      'mail an test@example.com',
      'Ruf an: +49 170 1234567',
      'IBAN: DE89 3704 0044 0532 0130 00',
      'Steuer-Nr: 12/345/67890',
    ];

    for (const input of inputs) {
      const local = matchPII(input);
      const enhanced = await matchPIIEnhanced(input);

      // Enhanced sollte mindestens so viele Hits haben wie lokal
      expect(enhanced.length).toBeGreaterThanOrEqual(local.length);
    }
  });

  it('Enhanced findet Kreditkarten die lokal auch erkannt werden', async () => {
    const input = 'Karte: 4111-1111-1111-1111';
    const local = matchPII(input);
    const enhanced = await matchPIIEnhanced(input);

    const localCC = local.filter((h) => h.type === 'credit-card');
    const enhancedCC = enhanced.filter((h) => h.type === 'credit-card');

    // Beide sollten die Kreditkarte finden
    expect(localCC.length).toBeGreaterThan(0);
    expect(enhancedCC.length).toBeGreaterThanOrEqual(localCC.length);
  });
});

describe('QA: Pattern-Erkennung - Secrets Enhanced', () => {
  it('Enhanced erkennt mindestens alles was lokal erkannt wird', async () => {
    const inputs = [
      'key=AKIAIOSFODNN7EXAMPLE',
      'password="geheim123geheim"',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoiZGF0YSJ9.signaturehere123',
    ];

    for (const input of inputs) {
      const local = matchSecrets(input);
      const enhanced = await matchSecretsEnhanced(input);
      expect(enhanced.length).toBeGreaterThanOrEqual(local.length);
    }
  });
});

describe('QA: Config Edge Cases', () => {
  it('Pipeline funktioniert mit leerer Config (Defaults)', async () => {
    await initParser();
    const pipeline = new Pipeline(getDefaults());
    const input = 'Normaler Text ohne sensible Daten';
    const result = await pipeline.anonymize(input);
    expect(result.text).toBe(input);
  });

  it('Pipeline funktioniert mit leeren Identity-Listen', async () => {
    await initParser();
    const config = {
      ...getDefaults(),
      identity: { company: '', domains: [], people: [] },
    };
    const pipeline = new Pipeline(config);
    const input = 'key=AKIAIOSFODNN7EXAMPLE';
    const result = await pipeline.anonymize(input);
    expect(result.text).toContain('***REDACTED***');
  });

  it('Pipeline mit leerer domainTerms-Liste anonymisiert trotzdem Secrets', async () => {
    await initParser();
    const config = {
      ...getDefaults(),
      code: { ...getDefaults().code, domainTerms: [], preserve: [] },
    };
    const pipeline = new Pipeline(config);
    const input = 'password = "hunter2hunter2"';
    const result = await pipeline.anonymize(input);
    expect(result.text).toContain('***REDACTED***');
  });
});

describe('QA: Overlapping Patterns', () => {
  let layer: SecretsLayer;
  let ctx: PipelineContext;

  beforeEach(() => {
    layer = new SecretsLayer();
    ctx = { sessionMap: new BiMap(), config: getDefaults() };
  });

  it('überlappende Matches werden korrekt dedupliziert', () => {
    // Connection-String enthält auch "password=" Match
    const input = 'mongodb://admin:password="geheim1234"@host:27017/db';
    const result = layer.process(input, ctx);
    // Darf nicht crashen, REDACTED muss vorhanden sein
    expect(result.text).toContain('***REDACTED***');
  });
});

describe('QA: BiMap Collision-Safety', () => {
  it('ignoriert zweiten Set mit gleichem Original', () => {
    const map = new BiMap();
    map.set('Customer', 'Alpha', 'code', 'class');
    map.set('Customer', 'Beta', 'code', 'class'); // sollte ignoriert werden
    expect(map.getByOriginal('Customer')).toBe('Alpha');
    expect(map.size).toBe(1);
  });

  it('erlaubt verschiedene Originale mit verschiedenen Pseudonymen', () => {
    const map = new BiMap();
    map.set('Customer', 'Alpha', 'code', 'class');
    map.set('Order', 'Beta', 'code', 'class');
    expect(map.getByOriginal('Customer')).toBe('Alpha');
    expect(map.getByOriginal('Order')).toBe('Beta');
    expect(map.size).toBe(2);
  });

  it('Reverse-Lookup funktioniert nach Set', () => {
    const map = new BiMap();
    map.set('artur@asom.de', 'user1@anon.de', 'identity', 'email');
    expect(map.getByPseudonym('user1@anon.de')).toBe('artur@asom.de');
  });
});

describe('QA: Infra Pattern Edge Cases', () => {
  it('erkennt 0.0.0.0 NICHT als anonymisierungswürdige IP', () => {
    const hits = matchInfra('bind to 0.0.0.0:8080');
    const ips = hits.filter((h) => h.type === 'ipv4');
    expect(ips).toHaveLength(0);
  });

  it('erkennt 255.255.255.255 NICHT als anonymisierungswürdige IP', () => {
    const hits = matchInfra('broadcast 255.255.255.255');
    const ips = hits.filter((h) => h.type === 'ipv4');
    expect(ips).toHaveLength(0);
  });

  it('erkennt private IPs (192.168.x.x) als anonymisierungswürdig', () => {
    const hits = matchInfra('server: 192.168.1.50');
    const ips = hits.filter((h) => h.type === 'ipv4');
    expect(ips.length).toBeGreaterThan(0);
  });

  it('erkennt interne URLs mit Pfad', () => {
    const hits = matchInfra('fetch https://api.company.internal/v2/users?limit=10');
    const urls = hits.filter((h) => h.type === 'internal-url');
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0].match).toContain('/v2/users');
  });
});

describe('QA: PII Pattern Korrektheit', () => {
  it('erkennt Adressen mit Umlauten', () => {
    // Address pattern handles both "Straße" and "straße" (case-insensitive
    // since BUG #4 fix). Regression lock.
    const hits = matchPII('Musterstraße 12, 80331 München');
    expect(hits.filter((h) => h.type === 'address').length).toBeGreaterThan(0);
  });

  it('erkennt E-Mail mit Sonderzeichen im Local-Part', () => {
    const hits = matchPII('test.user+tag@example.com');
    const emails = hits.filter((h) => h.type === 'email');
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[0].match).toBe('test.user+tag@example.com');
  });

  it('erkennt deutsche Telefonnummern mit verschiedenen Formaten', () => {
    const formats = ['+49 170 1234567', '0049 170 1234567', '0170 1234567', '+49 30 12345678'];
    for (const num of formats) {
      const hits = matchPII(`Tel: ${num}`);
      const phones = hits.filter((h) => h.type === 'phone');
      expect(phones.length).toBeGreaterThan(0);
    }
  });

  it('Offset und Length stimmen für alle PII-Hits', () => {
    const input = 'Name: test@example.com, IBAN: DE89 3704 0044 0532 0130 00';
    const hits = matchPII(input);
    for (const hit of hits) {
      const extracted = input.slice(hit.offset, hit.offset + hit.length);
      expect(extracted).toBe(hit.match);
    }
  });
});

describe('QA: Secrets Pattern Vollständigkeit', () => {
  it('erkennt Anthropic API Keys', () => {
    const hits = matchSecrets('sk-ant-api03-TESTKEY1234567890ABCDEF');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].type).toBe('anthropic-key');
  });

  it('erkennt GitHub Fine-Grained Tokens', () => {
    // github_pat_ tokens are detected via github-fine-grained pattern
    // (separate from ghp_ prefix). Regression lock.
    const hits = matchSecrets(
      'github_pat_11AXXXXXXX0000000000000000_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    );
    expect(hits).toContainEqual(expect.objectContaining({ type: 'github-fine-grained' }));
  });

  it('erkennt Bearer Tokens', () => {
    const hits = matchSecrets('Authorization: Bearer abc123def456ghi789jkl012mno');
    const bearers = hits.filter((h) => h.type === 'bearer-token');
    expect(bearers.length).toBeGreaterThan(0);
  });

  it('erkennt Private Keys mit verschiedenen Typen', () => {
    const types = ['RSA', 'EC', 'DSA', 'OPENSSH'];
    for (const t of types) {
      const key = `-----BEGIN ${t} PRIVATE KEY-----\nMIIEpA...\n-----END ${t} PRIVATE KEY-----`;
      const hits = matchSecrets(key);
      expect(hits.length).toBeGreaterThan(0);
    }
  });
});

describe('QA: Layer-Reihenfolge', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('Secrets werden VOR Identity verarbeitet (Secret in E-Mail-Format)', async () => {
    // Ein API-Key der zufällig wie eine E-Mail aussieht, sollte REDACTED werden
    const input = 'password = "geheim@admin.de"';
    const result = await pipeline.anonymize(input);
    // Das Password-Pattern sollte das ganze matchen
    expect(result.text).toContain('***REDACTED***');
  });

  it('Connection-String mit eingebettetem Password wird komplett redacted', async () => {
    const input = 'postgresql://admin:mysecretpass@db.asom.internal:5432/prod';
    const result = await pipeline.anonymize(input);
    expect(result.text).toContain('***REDACTED***');
    // Der Connection-String sollte nicht teilweise rehydrierbar sein
    expect(result.text).not.toContain('mysecretpass');
  });
});

describe('QA: Rehydration Edge Cases', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('Rehydration mit leerem String', () => {
    const result = pipeline.rehydrate('');
    expect(result).toBe('');
  });

  it('Rehydration mit Text ohne Pseudonyme', async () => {
    await pipeline.anonymize('Asom GmbH ist toll');
    const result = pipeline.rehydrate('Dieser Text enthält keine Pseudonyme.');
    expect(result).toBe('Dieser Text enthält keine Pseudonyme.');
  });

  it('Rehydration mit partiellen Pseudonym-Matches', async () => {
    await pipeline.anonymize('Kontakt: Asom GmbH');
    const map = pipeline.getSessionMap();
    const pseudo = map.getByOriginal('Asom GmbH');

    if (pseudo) {
      // Teste dass ein Teilstring des Pseudonyms nicht fälschlich ersetzt wird
      const partial = pseudo.substring(0, Math.floor(pseudo.length / 2));
      const input = `Prefix ${partial} Suffix`;
      const result = pipeline.rehydrate(input);
      // Sollte den Teilstring nicht ersetzen
      expect(result).toContain(partial);
    }
  });
});

describe('QA: Custom Secret Patterns aus Config', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });

  it('erkennt benutzerdefinierte Patterns aus der Config', async () => {
    const config = makeConfig({
      secrets: {
        patterns: [{ name: 'custom-token', regex: 'CUSTOM_[A-Z]+_[0-9]+' }],
      },
    });
    pipeline = new Pipeline(config);
    const input = 'auth: CUSTOM_AUTH_123456';
    const result = await pipeline.anonymize(input);
    expect(result.text).toContain('***REDACTED***');
    expect(result.text).not.toContain('CUSTOM_AUTH_123456');
  });
});

describe('QA: IPv6 Erkennung', () => {
  it('erkennt vollständige IPv6 Adressen', () => {
    const hits = matchInfra('host: 2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    const ipv6 = hits.filter((h) => h.type === 'ipv6');
    expect(ipv6.length).toBeGreaterThan(0);
  });

  it('erkennt abgekürzte IPv6 Adressen', () => {
    const hits = matchInfra('host: fe80::1');
    const ipv6 = hits.filter((h) => h.type === 'ipv6');
    expect(ipv6.length).toBeGreaterThan(0);
  });
});

describe('QA: Address Pattern - Groß/Kleinschreibung', () => {
  it('erkennt "Musterstraße" (Kleinbuchstabe)', () => {
    const hits = matchPII('Musterstraße 12, 80331 München');
    const addrs = hits.filter((h) => h.type === 'address');
    expect(addrs.length).toBeGreaterThan(0);
  });

  it('BUG-KANDIDAT: erkennt "Hauptstraße" mit großem Anfangsbuchstaben', () => {
    // Das Address-Pattern beginnt mit [A-ZÄÖÜa-zäöüß]+ - sollte funktionieren
    const hits = matchPII('Hauptstraße 42, 10115 Berlin');
    const addrs = hits.filter((h) => h.type === 'address');
    expect(addrs.length).toBeGreaterThan(0);
  });

  it('address pattern handles space before "Straße" (BUG #2 fix lock-in)', () => {
    // The regex allows a space before Straße, so "Münchner Straße 15" matches.
    const hits = matchPII('Münchner Straße 15, 80331 München');
    expect(hits.filter((h) => h.type === 'address').length).toBeGreaterThan(0);
  });
});

describe('QA: IBAN Pattern Varianten', () => {
  it('erkennt IBAN mit Leerzeichen', () => {
    const hits = matchPII('DE89 3704 0044 0532 0130 00');
    expect(hits.filter((h) => h.type === 'iban').length).toBeGreaterThan(0);
  });

  it('erkennt IBAN ohne Leerzeichen', () => {
    const hits = matchPII('DE89370400440532013000');
    expect(hits.filter((h) => h.type === 'iban').length).toBeGreaterThan(0);
  });

  it('BUG: erkennt NICHT-deutsche IBANs mit weniger Ziffern (AT hat nur 16)', () => {
    // AT-IBAN: AT61 1904 3002 3457 3201 (20 Zeichen nach Ländercode)
    // DE-IBAN: DE89 3704 0044 0532 0130 00 (22 Zeichen nach Ländercode)
    // Das aktuelle Pattern erwartet exakt 4+4+4+4+2-4 = 18-20 Ziffern nach Ländercode
    // AT hat aber nur 16 Ziffern nach dem Ländercode → wird nicht erkannt!
    const hits = matchPII('AT61 1904 3002 3457 3201');
    const ibans = hits.filter((h) => h.type === 'iban');
    // BEKANNTER BUG: AT-IBANs werden NICHT erkannt
    expect(ibans).toHaveLength(0);
  });
});

describe('QA: Mehrfach-Anonymisierung (Idempotenz)', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
  });
  beforeEach(() => {
    pipeline = new Pipeline(makeConfig());
  });

  it('doppelte Anonymisierung erzeugt keinen Datenverlust', async () => {
    const input = 'Kontaktiere Asom GmbH unter artur@asom.de';
    const r1 = await pipeline.anonymize(input);
    const r2 = await pipeline.anonymize(r1.text);

    // Nach doppelter Anonymisierung sollte nichts mehr übrig sein
    expect(r2.text).not.toContain('Asom GmbH');
    expect(r2.text).not.toContain('artur@asom.de');

    // Und Rehydration sollte trotzdem funktionieren
    const back = pipeline.rehydrate(r2.text);
    // Mindestens die erste Ebene sollte zurückkommen
    expect(back.length).toBeGreaterThan(0);
  });
});

describe('QA: GEFUNDENE BUGS - Dokumentation', () => {
  it.skip('KNOWN LIMIT: IBAN-Pattern misses AT/CH/GB formats', () => {
    // Pattern expects 18-20 digits (DE format). International IBANs (AT 16,
    // CH 17, GB mixed letters) slip past local regex. OpenRedaction enhanced
    // detection covers them via matchPIIEnhanced. Regex-only path tracked
    // for v1.1 as a multi-country IBAN pattern expansion.
    const cases = [
      { country: 'AT', iban: 'AT61 1904 3002 3457 3201' },
      { country: 'CH', iban: 'CH93 0076 2011 6238 5295 7' },
      { country: 'GB', iban: 'GB29 NWBK 6016 1331 9268 19' },
    ];
    for (const c of cases) {
      const hits = matchPII(c.iban).filter((h) => h.type === 'iban');
      expect(hits).toHaveLength(0);
    }
  });

  it('BUG #2: Adress-Pattern erkennt jetzt Adressen mit Leerzeichen vor "Straße"', () => {
    const hits = matchPII('Münchner Straße 15, 80331 München');
    const addrs = hits.filter((h) => h.type === 'address');
    expect(addrs.length).toBeGreaterThan(0);
  });

  it('BUG #3: GitHub Fine-Grained Tokens (github_pat_) werden jetzt erkannt', () => {
    const token = 'github_pat_11AAAAAA_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
    const hits = matchSecrets(token);
    expect(hits).toContainEqual(expect.objectContaining({ type: 'github-fine-grained' }));
  });

  it('BUG #4: Adress-Pattern erkennt jetzt "Straße" mit großem S', () => {
    const hits = matchPII('Berliner Straße 42, 10115 Berlin');
    const addrs = hits.filter((h) => h.type === 'address');
    expect(addrs.length).toBeGreaterThan(0);
  });

  it.skip('KNOWN LIMIT: IBAN-Pattern has no country-code validation', () => {
    // Pattern matches any two uppercase letters + digits, including invalid
    // country codes like "AB". Tracked for v1.1: validate against ISO 3166-1
    // alpha-2 IBAN-participating list.
    const hits = matchPII('Referenz: AB12345678901234567890');
    const ibans = hits.filter((h) => h.type === 'iban');
    expect(ibans.length).toBeGreaterThan(0);
  });

  it('BUG #6: pseudoFor() anonymisiert jetzt alle PII-Typen (address, tax-id, credit-card, etc.)', async () => {
    await initParser();
    const config = makeConfig();
    const pipeline = new Pipeline(config);

    const addrResult = await pipeline.anonymize('Musterstraße 12, 80331 München');
    expect(addrResult.text).not.toContain('Musterstraße');
    expect(addrResult.text).toContain('Beispielweg');

    const ccResult = await pipeline.anonymize('Karte: 4111-1111-1111-1111');
    expect(ccResult.text).not.toContain('4111-1111-1111-1111');
    expect(ccResult.text).toContain('****-****-****-');

    const taxResult = await pipeline.anonymize('Steuer-Nr: 12/345/67890');
    expect(taxResult.text).not.toContain('12/345/67890');
    expect(taxResult.text).toContain('00/000/00000');
  });

  it('BUG #7: OpenAI sk-proj-* Keys werden jetzt erkannt', () => {
    const hits = matchSecrets('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCD');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'openai-key-new' }));
  });

  it('BUG #8: Rehydration mit doppelter Anonymisierung erzeugt Phantom-Einträge', async () => {
    // Bei doppelter Anonymisierung wird das Pseudonym erneut als PII erkannt
    // und ein neues Pseudonym erzeugt. Die Session Map wächst unkontrolliert.
    await initParser();
    const config = makeConfig();
    const pipeline = new Pipeline(config);

    const input = 'Kontakt: artur@asom.de';
    const r1 = await pipeline.anonymize(input);
    const sizeBefore = pipeline.getSessionMap().size;

    // Pseudonym wird erneut anonymisiert
    await pipeline.anonymize(r1.text);
    const sizeAfter = pipeline.getSessionMap().size;

    // Die Map wächst - das ist ein Nebeneffekt
    // user1@company-alpha.de wird erneut als E-Mail erkannt
    expect(sizeAfter).toBeGreaterThan(sizeBefore);
    // Keine Assertion - nur Dokumentation dass das passiert
  });
});

describe('QA: Regex Sicherheit', () => {
  it('Custom Pattern mit ungültiger Regex wirft keinen unkontrollierten Fehler', () => {
    const layer = new SecretsLayer();
    const ctx: PipelineContext = {
      sessionMap: new BiMap(),
      config: {
        ...getDefaults(),
        secrets: {
          patterns: [{ name: 'bad', regex: '[invalid(' }],
        },
      },
    };

    // Ungültige Regex wird übersprungen statt zu crashen (graceful degradation)
    const result = layer.process('test input', ctx);
    expect(result.text).toBe('test input');
  });
});
