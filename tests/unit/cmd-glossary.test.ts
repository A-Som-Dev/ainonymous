import { describe, it, expect } from 'vitest';
import { validateGlossaryTerm, resolveConfigPath } from '../../src/cli/cmd-glossary.js';
import { resolve } from 'node:path';

describe('glossary: term validation', () => {
  it('accepts simple PascalCase', () => {
    expect(() => validateGlossaryTerm('CustomerService')).not.toThrow();
  });

  it('accepts snake_case and kebab-case with digits', () => {
    expect(() => validateGlossaryTerm('customer_service_v2')).not.toThrow();
    expect(() => validateGlossaryTerm('customer-service-v2')).not.toThrow();
    expect(() => validateGlossaryTerm('order42')).not.toThrow();
  });

  it('rejects YAML-injection via newline', () => {
    expect(() => validateGlossaryTerm('legit\nadmin: true')).toThrow(/invalid term/i);
  });

  it('rejects YAML-injection via carriage return', () => {
    expect(() => validateGlossaryTerm('foo\r\nbar: baz')).toThrow(/invalid term/i);
  });

  it('rejects terms with colons', () => {
    expect(() => validateGlossaryTerm('foo:bar')).toThrow(/invalid term/i);
  });

  it('rejects terms with whitespace', () => {
    expect(() => validateGlossaryTerm('foo bar')).toThrow(/invalid term/i);
    expect(() => validateGlossaryTerm('foo\tbar')).toThrow(/invalid term/i);
  });

  it('rejects terms with shell metacharacters', () => {
    expect(() => validateGlossaryTerm('foo;rm -rf /')).toThrow(/invalid term/i);
    expect(() => validateGlossaryTerm('foo$(ls)')).toThrow(/invalid term/i);
    expect(() => validateGlossaryTerm('foo|cat')).toThrow(/invalid term/i);
  });

  it('rejects empty and whitespace-only terms', () => {
    expect(() => validateGlossaryTerm('')).toThrow(/invalid term/i);
    expect(() => validateGlossaryTerm('   ')).toThrow(/invalid term/i);
  });

  it('rejects oversize terms (> 100 chars)', () => {
    const huge = 'a'.repeat(101);
    expect(() => validateGlossaryTerm(huge)).toThrow(/too long/i);
  });
});

describe('glossary: config path resolution', () => {
  it('resolves CONFIG_FILE inside the base dir', () => {
    const base = resolve('/tmp/project');
    const out = resolveConfigPath('/tmp/project');
    expect(out.startsWith(base)).toBe(true);
    expect(out).toMatch(/\.ainonymity\.yml$/);
  });

  it('normalizes relative dirs', () => {
    const cwd = process.cwd();
    const out = resolveConfigPath('.');
    expect(out.startsWith(cwd)).toBe(true);
  });

  it('rejects a --dir that tries to escape via parent segments inside join', () => {
    // simulates a hypothetical attack where CONFIG_FILE drifts via ..
    expect(() => resolveConfigPath('/tmp/project', '../../../etc/passwd')).toThrow(
      /path traversal/i,
    );
  });
});
