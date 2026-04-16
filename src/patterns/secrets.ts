import { detectWithOpenRedaction } from './openredaction-bridge.js';
import { mergeMatches, runPatterns, type PatternMatch, type PatternRule } from './utils.js';

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
]);

function isSecretType(type: string): boolean {
  return SECRET_OR_TYPES.has(type);
}

export function matchSecrets(input: string): PatternMatch[] {
  return runPatterns(input, SECRET_PATTERNS);
}

export async function matchSecretsEnhanced(input: string): Promise<PatternMatch[]> {
  const local = matchSecrets(input);

  let orHits: PatternMatch[];
  try {
    const all = await detectWithOpenRedaction(input);
    orHits = all.filter((h) => isSecretType(h.type));
  } catch (err) {
    if (process.env.DEBUG) console.warn('[ainonymity] openredaction error:', err);
    return local;
  }

  return mergeMatches(local, orHits);
}
