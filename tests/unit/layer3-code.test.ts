import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { CodeLayer } from '../../src/pipeline/layer3-code.js';
import { BiMap } from '../../src/session/map.js';
import { getDefaults } from '../../src/config/loader.js';
import type { PipelineContext } from '../../src/types.js';
import { initParser } from '../../src/ast/extractor.js';

describe('CodeLayer', () => {
  let layer: CodeLayer;
  let ctx: PipelineContext;

  beforeAll(async () => {
    await initParser();
  });

  beforeEach(() => {
    layer = new CodeLayer();
    ctx = {
      sessionMap: new BiMap(),
      config: {
        ...getDefaults(),
        code: {
          ...getDefaults().code,
          domainTerms: ['Customer', 'Order', 'Discount'],
          preserve: ['Express', 'PrismaClient'],
        },
      },
    };
  });

  it('replaces domain terms in code', async () => {
    const code = 'class CustomerService { getCustomer() {} }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('Customer');
    expect(result.replacements.length).toBeGreaterThan(0);
  });

  it('preserves framework identifiers', async () => {
    const code = 'const app = Express(); const db = new PrismaClient();';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).toContain('Express');
    expect(result.text).toContain('PrismaClient');
  });

  it('keeps structural suffixes', async () => {
    const code = 'class CustomerService {}';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).toMatch(/Service/);
    expect(result.text).not.toMatch(/Customer/);
  });

  it('is consistent across multiple calls', async () => {
    const code1 = 'class CustomerService {}';
    const code2 = 'new CustomerService()';
    const r1 = await layer.processAsync(code1, ctx);
    const r2 = await layer.processAsync(code2, ctx);
    const pseudo1 = r1.text.match(/(\w+)Service/)?.[1];
    const pseudo2 = r2.text.match(/(\w+)Service/)?.[1];
    expect(pseudo1).toBe(pseudo2);
  });

  it('registers replacements in session map', async () => {
    await layer.processAsync('class CustomerService {}', ctx);
    expect(ctx.sessionMap.size).toBeGreaterThan(0);
  });

  it('handles @ainonymity:redact annotation', async () => {
    const code = '// @ainonymity:redact\nfunction secret() { return 42; }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).toContain('redacted');
    expect(result.text).not.toContain('return 42');
  });

  it('anonymizes all identifiers in sensitivePaths files', async () => {
    ctx.config.code.sensitivePaths = ['src/secrets/**'];
    ctx.filePath = 'src/secrets/keys.ts';
    const code = 'const plainHelper = 42;';
    const result = await layer.processAsync(code, ctx);
    // structural-only identifier "plainHelper" should be anonymized in sensitive mode
    expect(result.text).not.toContain('plainHelper');
  });

  it('does not apply sensitivePaths to non-matching files', async () => {
    ctx.config.code.sensitivePaths = ['src/secrets/**'];
    ctx.filePath = 'src/utils/helpers.ts';
    const code = 'function getHandler() { return true; }';
    const result = await layer.processAsync(code, ctx);
    // purely structural identifier should be preserved outside sensitive paths
    expect(result.text).toContain('getHandler');
  });

  it('redacts all function bodies when file matches redactBodies', async () => {
    ctx.config.code.redactBodies = ['src/internal/**'];
    ctx.filePath = 'src/internal/core.ts';
    const code = 'function compute() { return 42 + secret; }\nfunction other() { return "data"; }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('return 42');
    expect(result.text).not.toContain('"data"');
    expect(result.text).toContain('redacted');
  });

  it('anonymizes Java package paths with company domain', async () => {
    ctx.config.identity = { company: 'enbw', domains: ['enbw.de'], people: [] };
    ctx.config.code.domainTerms = ['Partner'];
    const code = 'package de.enbw.customerdb;\nimport de.enbw.customerdb.model.Customer;';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('enbw');
    expect(result.text).not.toContain('customerdb');
    // TLD should be preserved
    expect(result.text).toMatch(/package de\./);
  });

  it('handles braces in strings when redacting', async () => {
    const code = '// @ainonymity:redact\nfunction secret() { const s = "{ fake }"; return 42; }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).toContain('redacted');
    expect(result.text).not.toContain('return 42');
    expect(result.text).not.toContain('fake');
  });

  it('handles braces in comments when redacting', async () => {
    const code =
      '// @ainonymity:redact\nfunction secret() { // closing } not real\n  return 42;\n}';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).toContain('redacted');
    expect(result.text).not.toContain('return 42');
  });

  it('handles unterminated line comment at EOF without crashing', async () => {
    const code = '// @ainonymity:redact\nfunction secret() { // trailing comment no newline';
    await expect(layer.processAsync(code, ctx)).resolves.not.toThrow();
  });

  it('handles unterminated block comment at EOF without crashing', async () => {
    const code = '// @ainonymity:redact\nfunction secret() { /* trailing block no close';
    await expect(layer.processAsync(code, ctx)).resolves.not.toThrow();
  });

  it('handles file without trailing newline', async () => {
    ctx.config.code.redactBodies = ['**/*.ts'];
    ctx.filePath = 'src/a.ts';
    const code = 'function a() {\n  return 1;\n}';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).toContain('redacted');
    expect(result.text).not.toContain('return 1');
  });

  it('does not redact bodies for non-matching files', async () => {
    ctx.config.code.redactBodies = ['src/internal/**'];
    ctx.filePath = 'src/public/api.ts';
    const code = 'function compute() { return 42; }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).toContain('return 42');
  });

  it('redacts Java method bodies when file matches redactBodies', async () => {
    ctx.config.code.redactBodies = ['src/internal/**'];
    ctx.config.code.language = 'java';
    ctx.filePath = 'src/internal/Service.java';
    const code = 'public class Svc {\n  public void process() {\n    return secret;\n  }\n}';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('return secret');
    expect(result.text).toContain('redacted');
  });

  it('redacts Python function bodies when file matches redactBodies', async () => {
    ctx.config.code.redactBodies = ['**/*.py'];
    ctx.config.code.language = 'python';
    ctx.filePath = 'scripts/secret.py';
    const code = 'def process():\n    secret = 42\n    return secret\n';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('secret = 42');
    expect(result.text).toContain('redacted');
  });

  it('redacts Go function bodies when file matches redactBodies', async () => {
    ctx.config.code.redactBodies = ['**/*.go'];
    ctx.config.code.language = 'go';
    ctx.filePath = 'internal/handler.go';
    const code = 'package main\n\nfunc handle() {\n\treturn secret\n}';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('return secret');
    expect(result.text).toContain('redacted');
  });

  it('redacts entire Python file when AST extracts no bodies', async () => {
    ctx.config.code.redactBodies = ['**/*.py'];
    ctx.config.code.language = 'python';
    ctx.filePath = 'scripts/constants.py';
    // top-level code only, no functions — AST will find 0 bodies
    const code = 'SECRET_KEY = "hunter2hunter2"\nAPI_TOKEN = "abc123def456"\n';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('hunter2');
    expect(result.text).not.toContain('abc123def456');
    expect(result.text).toContain('redacted');
  });

  it('falls back to regex for unsupported languages', async () => {
    ctx.config.code.redactBodies = ['**/*.rb'];
    ctx.config.code.language = 'ruby';
    ctx.filePath = 'lib/secret.rb';
    // regex fallback only catches JS-style functions
    const code = 'function compute() { return secret; }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('return secret');
    expect(result.text).toContain('redacted');
  });

  it('redacts Kotlin expression-body functions', async () => {
    ctx.config.code.redactBodies = ['**/*.kt'];
    ctx.config.code.language = 'kotlin';
    ctx.filePath = 'src/Api.kt';
    const code = 'fun getToken() = "hunter2secret"';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('hunter2secret');
    expect(result.text).toContain('redacted');
  });

  it('redacts Python top-level constants alongside function bodies', async () => {
    ctx.config.code.redactBodies = ['**/*.py'];
    ctx.config.code.language = 'python';
    ctx.filePath = 'src/config.py';
    const code = 'SECRET_KEY = "hunter2topsecret"\n\ndef process():\n    return 42\n';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('hunter2topsecret');
    expect(result.text).not.toContain('return 42');
  });

  it('redacts TypeScript top-level constants alongside function bodies', async () => {
    ctx.config.code.redactBodies = ['**/*.ts'];
    ctx.config.code.language = 'typescript';
    ctx.filePath = 'src/config.ts';
    const code = 'const SECRET = "hunter2tsvalue";\nfunction process() { return 42; }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('hunter2tsvalue');
    expect(result.text).not.toContain('return 42');
  });

  it('redacts Kotlin top-level const val alongside block functions', async () => {
    ctx.config.code.redactBodies = ['**/*.kt'];
    ctx.config.code.language = 'kotlin';
    ctx.filePath = 'src/Constants.kt';
    const code = 'const val SECRET = "hunter2ktvalue"\nfun other() { return 1 }';
    const result = await layer.processAsync(code, ctx);
    expect(result.text).not.toContain('hunter2ktvalue');
  });
});
