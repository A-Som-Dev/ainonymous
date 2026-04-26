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
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', // ainonymous:allow
    );
    expect(hits).toContainEqual(expect.objectContaining({ type: 'jwt' }));
  });

  it('detects database connection strings', () => {
    const hits = matchSecrets('mongodb://admin:secretpass@db.internal:27017/mydb');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'connection-string' }));
  });

  it('detects private keys', () => {
    const hits = matchSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----', // ainonymous:allow
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

  it('detects UPPER_SNAKE credential constants in Python/Node/Go config modules', () => {
    // Regression: the "password:" regex only triggers when the literal word
    // "password" is adjacent to the value, so Python idioms like
    // `DB_PASS = 'ChangeMe2024-PG!prod'` used to slip through entirely.
    const samples = [
      "DB_PASS = 'ChangeMe2024-PG!prod'",
      "AARENET_PASS = 'aare-secret-2024'",
      'API_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
      "CLIENT_SECRET='oauth-client-secret-value'",
      "STRIPE_KEY = 'sk_live_1234567890'",
    ];
    for (const s of samples) {
      const hits = matchSecrets(s);
      expect(
        hits.some((h) => h.type === 'credential-constant'),
        `missed: ${s}`,
      ).toBe(true);
    }
  });

  it('detects credentials in docker-compose environment lists', () => {
    const samples = [
      '      - SMTP_PASS=Mail-2024-Acme!',
      '    - DB_PASSWORD=ChangeMe2024!',
      '  - OAUTH_CLIENT_SECRET=abc123xyz789',
    ];
    for (const s of samples) {
      const hits = matchSecrets(s);
      expect(
        hits.some((h) => h.type === 'compose-env-secret'),
        `missed: ${s}`,
      ).toBe(true);
    }
  });

  it('detects credentials embedded in connection URLs', () => {
    const samples = [
      'http://user:ChangeMe!@example.com:3128',
      'redis://:redis-secret-2024@redis.local:6379/0',
      'postgres://app:Pg-Pass-2024!@postgres.home.arpa:5432/db',
      'amqp://guest:guest-password@rabbit.local:5672/vhost',
    ];
    for (const s of samples) {
      const hits = matchSecrets(s);
      expect(
        hits.some((h) => h.type === 'url-userinfo'),
        `missed: ${s}`,
      ).toBe(true);
    }
  });

  it('detects CLI --password / --requirepass flags', () => {
    const samples = [
      'redis-server --requirepass redis-acme-secret-2024',
      'mysql --password=Pg-Root-2024!',
      'systemctl start app --passwd=Secret2024',
    ];
    for (const s of samples) {
      const hits = matchSecrets(s);
      expect(
        hits.some((h) => h.type === 'cli-password-flag'),
        `missed: ${s}`,
      ).toBe(true);
    }
  });

  it('detects POSIX short-flag credentials (mysql -pSecret)', () => {
    const samples = [
      'mysql -u root -pRootSecret2024',
      'mysqldump -pSecret2024Db myschema > dump.sql',
      'mongodump -pSecret2024 --out /backup',
      'redis-cli -pSecret2024 get foo',
      'pg_dump -U admin -pLeakedPassword123 -h db.corp prod',
      'mongosh -pThirdSecret2024',
      'docker exec -it mysql-container mysql -u root -pDockerSecret',
    ];
    for (const s of samples) {
      const hits = matchSecrets(s);
      expect(
        hits.some((h) => h.type === 'cli-password-flag'),
        `missed: ${s}`,
      ).toBe(true);
    }
  });

  it('detects credential constants in triple-quote / template-literal values', () => {
    const samples = [
      'API_TOKEN = """ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD"""',
      "DB_PASSWORD = '''prod-db-secret-xyz'''",
      'const CLIENT_SECRET = `sk-proj-abcdefghijklmnopqrstuvwxyz`;',
    ];
    for (const s of samples) {
      const hits = matchSecrets(s);
      expect(
        hits.some((h) => h.type === 'credential-constant'),
        `missed: ${s}`,
      ).toBe(true);
    }
  });

  it('detects url-userinfo with long custom enterprise schemes', () => {
    const hits = matchSecrets(
      'jdbc-oracle-thin-enterprise://svcacct:Sup3rS3cret2025@db.corp.internal/prod',
    );
    expect(hits.some((h) => h.type === 'url-userinfo')).toBe(true);
  });

  it('does not flag bare -p port flags as passwords', () => {
    const clean = ['docker run -p 8080:80 nginx', 'ssh -p 2222 user@host'];
    for (const s of clean) {
      const hits = matchSecrets(s).filter((h) => h.type === 'cli-password-flag');
      expect(hits, `false positive: ${s}`).toHaveLength(0);
    }
  });

  it('detects fullwidth-unicode credential assignments', () => {
    const text = 'DB_PASS\uFF1D\uFF02secret1234\uFF02';
    const hits = matchSecrets(text);
    expect(hits.some((h) => h.type === 'credential-constant')).toBe(true);
  });

  it('detects url-userinfo across quote / bracket boundaries', () => {
    const samples = [
      '"postgres://app:Pg-Pass-2024!@db.internal:5432/mydb"',
      '[http://oauth2:gho_TOKEN12345678@github.com/org/repo.git]',
      '<redis://:redis-secret-2024@redis:6379/0>',
    ];
    for (const s of samples) {
      const hits = matchSecrets(s);
      expect(
        hits.some((h) => h.type === 'url-userinfo'),
        `missed: ${s}`,
      ).toBe(true);
    }
  });

  it('does not flag plain https:// URLs as userinfo credentials', () => {
    const clean = [
      'https://example.com/path',
      'http://localhost:3000',
      'postgres://example.com:5432/db',
    ];
    for (const s of clean) {
      const hits = matchSecrets(s).filter((h) => h.type === 'url-userinfo');
      expect(hits, `false positive: ${s}`).toHaveLength(0);
    }
  });

  it('does not flag harmless UPPER_SNAKE assignments', () => {
    const clean = [
      'TIMEOUT_SECONDS = 30',
      'MAX_RETRIES = 5',
      'ENABLE_CACHE = True',
      "LOG_LEVEL = 'INFO'",
    ];
    for (const s of clean) {
      const hits = matchSecrets(s).filter((h) => h.type === 'credential-constant');
      expect(hits, `false positive: ${s}`).toHaveLength(0);
    }
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

  it('folds cyrillic/latin homoglyphs via confusables map', () => {
    // 'api_key' with a leading Cyrillic 'а' (U+0430) must still trigger the
    // password-assignment rule once confusables are folded to Latin baseline.
    const text = '\u0430pi_key = "sk-ant-abcdefghij1234567890"';
    const hits = matchSecrets(text);
    const pw = hits.filter((h) => h.type === 'password');
    expect(pw.length).toBeGreaterThan(0);
  });
});
