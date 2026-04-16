import { describe, it, expect } from 'vitest';
import { pathMatchesAny, splitIdentifier, escapeRegex } from '../../src/shared.js';

describe('pathMatchesAny', () => {
  it('matches exact paths', () => {
    expect(pathMatchesAny('.env', ['.env'])).toBe(true);
    expect(pathMatchesAny('.env.local', ['.env'])).toBe(false);
  });

  it('matches prefix directories', () => {
    expect(pathMatchesAny('src/secrets/keys.ts', ['src/secrets'])).toBe(true);
    expect(pathMatchesAny('src/other/file.ts', ['src/secrets'])).toBe(false);
  });

  it('matches ** prefix + suffix patterns', () => {
    expect(pathMatchesAny('certs/server.pem', ['**/*.pem'])).toBe(true);
    expect(pathMatchesAny('deep/nested/file.key', ['**/*.key'])).toBe(true);
    expect(pathMatchesAny('file.ts', ['**/*.pem'])).toBe(false);
    expect(pathMatchesAny('file.pem.bak', ['**/*.pem'])).toBe(false);
  });

  it('matches ** directory patterns', () => {
    expect(pathMatchesAny('src/internal/core.ts', ['src/internal/**'])).toBe(true);
    expect(pathMatchesAny('src/public/api.ts', ['src/internal/**'])).toBe(false);
  });

  it('matches single * wildcard', () => {
    expect(pathMatchesAny('.env.local', ['.env.*'])).toBe(true);
    expect(pathMatchesAny('.env.production', ['.env.*'])).toBe(true);
    expect(pathMatchesAny('.env', ['.env.*'])).toBe(false);
  });

  it('normalizes Windows backslashes', () => {
    expect(pathMatchesAny('src\\secrets\\keys.ts', ['src/secrets/**'])).toBe(true);
  });

  it('returns false for empty patterns', () => {
    expect(pathMatchesAny('any/file.ts', [])).toBe(false);
  });

  it('matches any of multiple patterns', () => {
    expect(pathMatchesAny('config/db.key', ['.env', '**/*.pem', '**/*.key'])).toBe(true);
  });
});

describe('splitIdentifier', () => {
  it('splits camelCase', () => {
    expect(splitIdentifier('customerService')).toEqual(['customer', 'Service']);
  });

  it('splits PascalCase', () => {
    expect(splitIdentifier('CustomerService')).toEqual(['Customer', 'Service']);
  });

  it('handles consecutive caps', () => {
    expect(splitIdentifier('HTMLParser')).toEqual(['HTML', 'Parser']);
  });
});

describe('escapeRegex', () => {
  it('escapes special regex chars', () => {
    expect(escapeRegex('user.name')).toBe('user\\.name');
    expect(escapeRegex('a+b')).toBe('a\\+b');
  });
});
