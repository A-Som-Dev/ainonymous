import { describe, it, expect } from 'vitest';
import { matchSecrets } from '../../src/patterns/secrets.js';

describe('secret patterns', () => {
  it('detects AWS access keys', () => {
    const hits = matchSecrets('key = AKIAIOSFODNN7EXAMPLE');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'aws-access-key' }));
  });

  it('detects generic API keys in assignments', () => {
    const hits = matchSecrets('API_KEY="sk-1234567890abcdef1234567890abcdef"');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('detects JWT tokens', () => {
    const hits = matchSecrets(
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    );
    expect(hits).toContainEqual(expect.objectContaining({ type: 'jwt' }));
  });

  it('detects database connection strings', () => {
    const hits = matchSecrets('mongodb://admin:secretpass@db.internal:27017/mydb');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'connection-string' }));
  });

  it('detects private keys', () => {
    const hits = matchSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----',
    );
    expect(hits).toContainEqual(expect.objectContaining({ type: 'private-key' }));
  });

  it('detects password assignments', () => {
    const hits = matchSecrets('db_password = "hunter2!"');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'password' }));
  });

  it('does not flag normal code', () => {
    const hits = matchSecrets('const name = "hello world";');
    expect(hits).toHaveLength(0);
  });

  it('returns match positions', () => {
    const hits = matchSecrets('token = AKIAIOSFODNN7EXAMPLE');
    expect(hits[0].offset).toBeGreaterThanOrEqual(0);
    expect(hits[0].length).toBeGreaterThan(0);
  });

  it('detects Dockerfile ENV secrets', () => {
    const hits = matchSecrets('ENV DB_PASSWORD=mysecretpassword123');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContainEqual(expect.objectContaining({ type: 'dockerfile-env-secret' }));
  });

  it('detects Dockerfile ARG secrets', () => {
    const hits = matchSecrets('ARG API_KEY=default_secret_value');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContainEqual(expect.objectContaining({ type: 'dockerfile-env-secret' }));
  });

  it('does not flag Dockerfile ENV without secret keyword', () => {
    const hits = matchSecrets('ENV NODE_ENV=production');
    const dockerHits = hits.filter((h) => h.type === 'dockerfile-env-secret');
    expect(dockerHits).toHaveLength(0);
  });

  it('detects K8s secret data', () => {
    const hits = matchSecrets('  password: dGVzdHBhc3N3b3JkMTIz');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContainEqual(expect.objectContaining({ type: 'k8s-secret-data' }));
  });

  it('does not flag short K8s values', () => {
    const hits = matchSecrets('  name: myapp');
    const k8sHits = hits.filter((h) => h.type === 'k8s-secret-data');
    expect(k8sHits).toHaveLength(0);
  });

  it('detects .env file lines', () => {
    const hits = matchSecrets('ANTHROPIC_API_KEY=sk-ant-very-long-secret-key-here');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('does not flag .env boolean or numeric values', () => {
    const hitsTrue = matchSecrets('DEBUG_MODE=true');
    const hitsFalse = matchSecrets('VERBOSE=false');
    const hitsNum = matchSecrets('PORT=3000');
    const envTrue = hitsTrue.filter((h) => h.type === 'env-file-secret');
    const envFalse = hitsFalse.filter((h) => h.type === 'env-file-secret');
    const envNum = hitsNum.filter((h) => h.type === 'env-file-secret');
    expect(envTrue).toHaveLength(0);
    expect(envFalse).toHaveLength(0);
    expect(envNum).toHaveLength(0);
  });
});

describe('unicode bypass resistance', () => {
  it('still detects anthropic key when ZWJ is injected into the keyword', () => {
    const text = 'ap\u200Bi_key = "sk-ant-abcdefghij1234567890"';
    const hits = matchSecrets(text);
    // should catch either the anthropic-key token or the password-style assignment
    const relevant = hits.filter((h) => h.type === 'anthropic-key' || h.type === 'password');
    expect(relevant.length).toBeGreaterThan(0);
  });

  it('detects password assignment when ZWJ is injected into the keyword', () => {
    const text = 'pass\u200Bword = "hunter2superlongvalue"';
    const hits = matchSecrets(text);
    expect(hits).toContainEqual(expect.objectContaining({ type: 'password' }));
  });

  it('detects secret when text uses fullwidth ASCII (NFKC compatibility)', () => {
    // fullwidth 'password=' followed by a plain value
    const fullwidth = '\uFF50\uFF41\uFF53\uFF53\uFF57\uFF4F\uFF52\uFF44=hunter2superlongvalue';
    const hits = matchSecrets(fullwidth);
    expect(hits).toContainEqual(expect.objectContaining({ type: 'password' }));
  });

  it('preserves match position so original (including bypass chars) gets redacted', () => {
    const text = 'pass\u200Bword = "hunter2superlongvalue"';
    const hits = matchSecrets(text);
    const pw = hits.find((h) => h.type === 'password');
    expect(pw).toBeDefined();
    // offset+length should cover the original span including the ZWJ
    const original = text.slice(pw!.offset, pw!.offset + pw!.length);
    expect(original).toContain('\u200B');
  });

  it('does NOT fix kyrillisch/lateinisch homoglyphs (documented out of scope)', () => {
    // 'api_key' where 'a' is kyrillisch U+0430. NFKC does not unify cyrillic and
    // latin. This is future work via a confusables table; see SECURITY.md.
    const text = '\u0430pi_key = "sk-ant-abcdefghij1234567890"';
    const hits = matchSecrets(text);
    const pw = hits.filter((h) => h.type === 'password');
    expect(pw).toHaveLength(0);
  });
});
