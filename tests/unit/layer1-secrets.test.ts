import { describe, it, expect, beforeEach } from 'vitest';
import { SecretsLayer } from '../../src/pipeline/layer1-secrets.js';
import { BiMap } from '../../src/session/map.js';
import { getDefaults } from '../../src/config/loader.js';
import type { PipelineContext } from '../../src/types.js';

describe('SecretsLayer', () => {
  let layer: SecretsLayer;
  let ctx: PipelineContext;

  beforeEach(() => {
    layer = new SecretsLayer();
    ctx = { sessionMap: new BiMap(), config: getDefaults() };
  });

  it('redacts AWS keys', () => {
    const result = layer.process('key=AKIAIOSFODNN7EXAMPLE', ctx);
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).toContain('***REDACTED***');
    expect(result.replacements).toHaveLength(1);
  });

  it('redacts connection strings', () => {
    const result = layer.process('url: mongodb://user:pass@host:27017/db', ctx);
    expect(result.text).not.toContain('user:pass');
    expect(result.text).toContain('***REDACTED***');
  });

  it('redacts custom patterns from config', () => {
    ctx.config.secrets.patterns = [{ name: 'asom-key', regex: 'ASOM_[A-Z]+_KEY=[^\\s]+' }];
    const result = layer.process('ASOM_SERVICE_KEY=abc123secret', ctx);
    expect(result.text).toContain('***REDACTED***');
  });

  it('leaves clean code untouched', () => {
    const code = 'function add(a: number, b: number) { return a + b; }';
    const result = layer.process(code, ctx);
    expect(result.text).toBe(code);
    expect(result.replacements).toHaveLength(0);
  });

  it('handles multiple secrets in one text', () => {
    const text = 'key=AKIAIOSFODNN7EXAMPLE and db=mongodb://u:p@host/db';
    const result = layer.process(text, ctx);
    expect(result.replacements.length).toBeGreaterThanOrEqual(2);
  });

  it('redacts quoted passwords containing spaces', () => {
    const result = layer.process('password="correct horse battery staple"', ctx);
    expect(result.text).not.toContain('correct horse battery staple');
    expect(result.text).toContain('***REDACTED***');
  });

  it('redacts short quoted passwords', () => {
    const result = layer.process("password='abc'", ctx);
    expect(result.text).not.toContain("'abc'");
    expect(result.text).toContain('***REDACTED***');
  });

  it('redacts unquoted short secrets', () => {
    const result = layer.process('pwd=short1', ctx);
    expect(result.text).not.toContain('short1');
    expect(result.text).toContain('***REDACTED***');
  });

  it('does not truncate AWS secret keys with trailing chars', () => {
    // 44 'A' chars: the 40-char matcher must not truncate and leak the rest
    const key = 'A'.repeat(44);
    const result = layer.process(`aws_secret_access_key=${key} trailing`, ctx);
    // either the full thing is caught or the match is rejected - but no partial leak
    const leakedPrefix = result.text.match(/A{40,}/);
    expect(leakedPrefix).toBeNull();
  });

  it('keeps REDACTED marker intact through the full pipeline', async () => {
    const { Pipeline } = await import('../../src/pipeline/pipeline.js');
    const { initParser } = await import('../../src/ast/extractor.js');
    const { getDefaults } = await import('../../src/config/loader.js');
    await initParser();
    const pipeline = new Pipeline({
      ...getDefaults(),
      code: { ...getDefaults().code, language: 'java' },
    });
    const result = await pipeline.anonymize('String DB_PASSWORD = "hunter2topsecret!";');
    expect(result.text).toContain('***REDACTED***');
    expect(result.text).not.toContain('hunter2topsecret');
  });
});
