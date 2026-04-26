import { detectWithOpenRedaction } from './openredaction-bridge.js';
import { mergeMatches, runPatterns, type PatternMatch, type PatternRule } from './utils.js';

// *_KEY identifiers that describe structure, not secrets. These are database,
// storage and crypto-metadata concepts. the name itself is public and shows
// up in schema docs, API responses, IaC templates. Flagging them as secrets
// pollutes the audit log and forces users to whitelist noise.
const NON_SECRET_KEY_SUFFIXES = [
  'PUBLIC_KEY',
  'PARTITION_KEY',
  'SORT_KEY',
  'PRIMARY_KEY',
  'FOREIGN_KEY',
  'UNIQUE_KEY',
  'OBJECT_STORE_KEY',
  'OBJECT_KEY',
  'ROW_KEY',
  'HASH_KEY',
  'MAP_KEY',
  'CACHE_KEY',
  'GPG_KEY',
  'PGP_KEY',
  'SSH_HOST_KEY',
  'HOST_KEY',
  'IDX_KEY',
  'INDEX_KEY',
];

function isNonSecretKeyName(match: string): boolean {
  if (!match.endsWith('_KEY')) return false;
  for (const suffix of NON_SECRET_KEY_SUFFIXES) {
    if (match === suffix || match.endsWith('_' + suffix)) return true;
  }
  return false;
}

export const SECRET_PATTERNS: PatternRule[] = [
  {
    type: 'aws-access-key',
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    // greedy {40,} so long keys are redacted fully; no truncation leak
    type: 'aws-secret-key',
    regex:
      /(?:aws_secret_access_key|secret_key|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40,})["']?/g,
  },
  {
    type: 'private-key',
    regex:
      /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE KEY-----/g,
  },
  {
    type: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    type: 'connection-string',
    regex: /(?:mongodb|postgres|postgresql|mysql|redis|amqp):\/\/[^\s"'`,;)}\]]+/g,
  },
  {
    type: 'github-token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  },
  {
    type: 'npm-token',
    regex: /npm_[A-Za-z0-9]{36,}/g,
  },
  {
    type: 'anthropic-key',
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    type: 'openai-key',
    regex: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g,
  },
  {
    type: 'bearer-token',
    regex: /Bearer\s+[A-Za-z0-9_.\-/+=]{20,}/g,
  },
  {
    // quoted values may contain spaces; unquoted values stop at whitespace/delimiter
    type: 'password',
    regex:
      /(?:password|passwd|pwd|secret|api_key|apikey|api-key)\s*[=:]\s*(?:"[^"]+"|'[^']+'|[^\s"',;]+)/gi,
  },
  {
    type: 'generic-secret',
    regex: /(?:SECRET|PRIVATE|CREDENTIAL)[_A-Z]*\s*[=:]\s*(?:"[^"]+"|'[^']+'|[^\s"',;]+)/g,
  },
  {
    // `DB_PASS = 'value'`, Python `TOKEN = """secret"""`, JS `KEY = `secret``.
    type: 'credential-constant',
    regex:
      /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:PASS|PASSWORD|PASSWD|SECRET|KEY|TOKEN|CRED|CREDENTIAL|APIKEY)\s*[:=]\s*(?:"""[^"]{4,}"""|'''[^']{4,}'''|"[^"]{4,}"|'[^']{4,}'|`[^`]{4,}`)/g,
  },
  {
    // Bare SCREAMING_SNAKE env-var name in prose. Leaks the internal config
    // convention even without the value. Needs 2+ name parts so plain English
    // words in docs don't trip it.
    type: 'credential-keyname',
    regex:
      /\b[A-Z][A-Z0-9_]*_(?:PASS|PASSWORD|PASSWD|PW|SECRET|TOKEN|KEY|APIKEY|CRED|CREDENTIAL)\b/g,
    filter: (match) => !isNonSecretKeyName(match),
  },
  {
    // Kafka SASL JAAS blocks: the password pattern catches the value, but the
    // matching username leaks the service-account name, so eat the whole
    // LoginModule statement as a unit.
    type: 'sasl-jaas',
    regex:
      /\b(?:[A-Za-z]+\.)*[A-Za-z]*LoginModule\s+(?:required|optional|sufficient|requisite)\b[\s\S]*?;/g,
  },
  {
    // Kubernetes secretKeyRef leaks the Secret object name.
    type: 'k8s-secret-ref',
    regex: /\bsecretKeyRef\s*:(?:\s|\n)+\s*name\s*:\s*[A-Za-z0-9_.-]+/gi,
  },
  {
    // AWS SSM Parameter Store paths. 4+ segments, at least one env marker,
    // system paths (/etc, /var, /usr ...) excluded via negative lookbehind.
    type: 'aws-ssm-path',
    regex:
      /(?<!\/(?:etc|var|usr|opt|home|bin|lib|dev|tmp|proc|sys|root|mnt|boot|srv|run))\/(?:[A-Za-z][A-Za-z0-9._-]{0,63}\/){2,}(?:prod|staging|stage|dev|preprod|qa|stg|test|production|development)\/[A-Za-z0-9._/-]{3,}|\/(?:prod|staging|stage|dev|preprod|qa|stg|test|production|development)\/(?:[A-Za-z0-9._-]+\/){1,}[A-Za-z0-9._/-]{3,}/gi,
  },
  {
    // Azure KeyVault secret URL / reference.
    type: 'azure-keyvault',
    regex: /\b[a-z0-9-]+\.vault\.azure\.net(?:\/secrets\/[A-Za-z0-9_./-]+)?/gi,
  },
  {
    // Vault KV paths under the `secret/` or `kv/` mounts.
    type: 'hashicorp-vault-path',
    regex: /\b(?:secret|kv)\/[a-z0-9_-]+(?:\/[a-z0-9_.-]+){1,8}/gi,
  },
  {
    // Keystore, key and certificate paths. Anchored on a `/` prefix so plain
    // filenames in prose don't trip.
    type: 'sensitive-cert-path',
    regex:
      /\/(?:[A-Za-z0-9._-]+\/){1,8}[A-Za-z0-9._-]+\.(?:jks|pem|key|p12|pfx|crt|keystore|truststore)\b/g,
  },
  {
    type: 'github-fine-grained',
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  },
  {
    type: 'openai-key-new',
    regex: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    type: 'spring-password',
    regex: /\.[a-z._-]*(?:password|secret|credential)\s*=\s*[^\s"']{8,}/gi,
  },
  {
    type: 'jdbc-connection',
    regex: /jdbc:[a-z]+:\/\/[^\s"']+/gi,
  },
  {
    type: 'properties-secret',
    regex: /^[a-z._-]*(?:password|secret|key|token|api-key)\s*=\s*[^\s]{6,}$/gim,
  },
  {
    type: 'dockerfile-env-secret',
    regex:
      /(?:ENV|ARG)\s+(?:\w*(?:PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL)\w*)\s*=\s*["']?[^\s"']{6,}["']?/gi,
  },
  {
    type: 'k8s-secret-data',
    regex: /(?:password|secret|key|token|credential)\s*:\s*[A-Za-z0-9+/=]{16,}/gi,
  },
  {
    type: 'env-file-secret',
    regex:
      /^[A-Z][A-Z0-9_]{2,}=(?!true$|false$|[0-9]+$|https?:\/\/localhost|production$|development$|staging$|test$|debug$|verbose$|info$|warn$|error$|utf-8$|en_US\.UTF-8$|\/usr\/|\/bin\/|\/opt\/|\/home\/|C:\\).{8,}$/gm,
  },
  {
    // `      - KEY=VALUE` docker-compose/k8s env list. plain env-file pattern
    // is ^-anchored and the YAML `- ` prefix breaks it.
    type: 'compose-env-secret',
    regex:
      /^[\t ]*-[\t ]+[A-Z][A-Z0-9_]*(?:PASS|PASSWORD|PASSWD|SECRET|KEY|TOKEN|CRED|CREDENTIAL|APIKEY)[A-Z0-9_]*=(?!true$|false$|[0-9]+$)[^\s]{6,256}$/gim,
  },
  {
    // `postgres://user:pass@db`, `http://oauth2:TOKEN@github.com/repo.git`. // ainonymous:allow
    // Scheme up to 64 chars for enterprise custom URIs (`jdbc-oracle-thin-…`).
    // `#` excluded from tail so fragments don't get swallowed into the secret.
    type: 'url-userinfo',
    regex: /\b[a-z][a-z0-9+\-.]{1,63}:\/\/[^\s:/@]{0,128}:[^\s@/]{3,128}@[^\s"',;<>)\]#]{1,512}/gi,
  },
  {
    // `--requirepass x`, `--password=x`, POSIX short form after a known CLI
    // (`mysql -pSecret`, `pg_dump -pSecret`). Extended anchor list covers
    // pg_dump/pg_restore/mongosh/mongorestore/influx/clickhouse-client/etcdctl
    // plus docker invocations. Bare `-p 8080` stays a false-negative. the
    // anchor requirement is the noise guard.
    type: 'cli-password-flag',
    regex:
      /--(?:requirepass|password|passwd)[\s=][^\s"']{4,128}|\b(?:mysql|mysqldump|mariadb|psql|pg_dump|pg_restore|redis-cli|mongo|mongosh|mongodump|mongorestore|influx|clickhouse-client|etcdctl|ftp|sshpass|mqtt|rabbitmqadmin|docker)\b[^\n]{0,120}-[pPwW](?=[^\s"']{3,64}[A-Za-z])[^\s"']{4,64}/g,
  },
];

const SECRET_OR_TYPES = new Set([
  'aws-access-key',
  'aws-secret-key',
  'private-key',
  'ssh-private-key',
  'jwt',
  'jwt-token',
  'connection-string',
  'database-connection',
  'github-token',
  'npm-token',
  'bearer-token',
  'generic-secret',
  'generic-api-key',
  'openai-api-key',
  'google-api-key',
  'stripe-api-key',
  'slack-token',
  'slack-webhook',
  'azure-storage-key',
  'oauth-client-secret',
  'oauth-token',
  'twilio-api-key',
  'sendgrid-api-key',
  'firebase-api-key',
  'mailgun-api-key',
  'heroku-api-key',
  'pypi-token',
  'kubernetes-secret',
  'password',
  'aws-arn',
  'dockerfile-env-secret',
  'k8s-secret-data',
  'env-file-secret',
  'credential-constant',
  'credential-keyname',
  'sasl-jaas',
  'k8s-secret-ref',
  'aws-ssm-path',
  'azure-keyvault',
  'hashicorp-vault-path',
  'sensitive-cert-path',
  'compose-env-secret',
  'url-userinfo',
  'cli-password-flag',
]);

function isSecretType(type: string): boolean {
  return SECRET_OR_TYPES.has(type);
}

export function matchSecrets(input: string): PatternMatch[] {
  return runPatterns(input, SECRET_PATTERNS);
}

export async function matchSecretsEnhanced(
  input: string,
  opts?: { filters?: readonly import('./or-filters/types.js').OrPostFilter[] },
): Promise<PatternMatch[]> {
  const local = matchSecrets(input);

  let orHits: PatternMatch[];
  try {
    const all = await detectWithOpenRedaction(input, { filters: opts?.filters as never });
    orHits = all.filter((h) => isSecretType(h.type));
  } catch (err) {
    if (process.env.DEBUG) console.warn('[ainonymous] openredaction error:', err);
    return local;
  }

  return mergeMatches(local, orHits);
}
