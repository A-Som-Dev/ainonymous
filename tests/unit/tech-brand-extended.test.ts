import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('Extended tech-stack version redaction', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('covers .NET, Go, Rust, Node.js, Scala, Ruby, Erlang, Elixir versions', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
    });
    const text = [
      'Backend: .NET 8.0, Go 1.22, Rust 1.75.',
      'API: Node.js 20.11, Scala 3.3.',
      'Legacy: Ruby 3.2, Erlang 26, Elixir 1.16.',
    ].join(' ');
    const result = await pipeline.anonymize(text);
    for (const v of ['8.0', '1.22', '1.75', '20.11', '3.3', '3.2', '1.16']) {
      expect(result.text, `version ${v} should be stripped`).not.toContain(v);
    }
  });
});

describe('Explicit case-insensitive tech brand whitelist', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('matches lowercase brand stems via explicit list, not length>=5 heuristic', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
      behavior: { ...getDefaults().behavior, aggression: 'high' },
    });
    const code = [
      'public class Client {',
      '  private OracleClient oracleClient;',
      '  private PostgresClient postgresClient;',
      '  private MongoClient mongoClient;',
      '}',
    ].join('\n');
    const result = await pipeline.anonymize(code);
    // Both casings of brand stems survive in the field identifier
    expect(result.text).toMatch(/\boracle\w*Client/i);
    expect(result.text).toMatch(/\bpostgres\w*Client/i);
    expect(result.text).toMatch(/\bmongo\w*Client/i);
  });

  it('does not preserve `next` as Next.js brand (short-token regression)', async () => {
    const pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'acme', domains: ['acme.com'], people: [] },
      code: { ...getDefaults().code, language: 'java', domainTerms: [], preserve: [] },
      behavior: { ...getDefaults().behavior, aggression: 'high' },
    });
    const code = 'public void handle(Order next) { process(next); }';
    const result = await pipeline.anonymize(code);
    expect(result.text).not.toMatch(/\bnext\b/);
  });
});
