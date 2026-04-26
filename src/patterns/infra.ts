import { detectWithOpenRedaction } from './openredaction-bridge.js';
import { mergeMatches, runPatterns, type PatternMatch, type PatternRule } from './utils.js';

const SKIP_IPS = new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255']);
const SKIP_IPV6 = new Set(['::', '::1']);
const MAC_RE = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/;

export const INFRA_PATTERNS: PatternRule[] = [
  {
    type: 'ipv4',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    filter: (val) => !SKIP_IPS.has(val),
  },
  {
    type: 'ipv6',
    regex: /\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){2,7}\b/g,
    filter: (val) => !SKIP_IPV6.has(val) && !MAC_RE.test(val),
  },
  {
    type: 'internal-url',
    regex:
      /https?:\/\/[^\s"'`,;)}\]]*\.(?:internal|local|corp|intranet|lan|private)(?:[/:][^\s"'`,;)}\]]*)?/g,
  },
  {
    type: 'mac',
    regex: /\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g,
  },
  {
    type: 'hostname-internal',
    regex:
      /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.(?:internal|local|corp|intranet|lan|private)\b/g,
  },
  {
    // Strip version numbers off tech-stack brands. Brand stays (LLM still
    // needs context), version goes (CVE / release cadence leak). Curated
    // brand list so plain numbers like "Order 4711" don't match.
    type: 'tech-version',
    regex:
      /\b(Spring Boot|Spring|Quarkus|Micronaut|Kafka|Oracle|Java|Kotlin|Scala|Python|Node(?:\.js)?|NET|Golang|Go|Rust|Ruby|Erlang|Elixir|Clojure|PHP|Perl|Camunda|Playwright|Puppeteer|Selenium|Cypress|Docker|Kubernetes|Helm|Terraform|Ansible|Puppet|Chef|Postgres(?:ql)?|MongoDB|Redis|Elasticsearch|Opensearch|Hibernate|Jackson|Lombok|React|Angular|Vue|Svelte|Nextjs|Nuxt|Nginx|Apache|Tomcat|Jetty|Netty|Maven|Gradle|Bazel|Raspberry(?:[- ]Pi)?|SQLite|MySQL|MariaDB|Cassandra|DynamoDB|Neo4j)\s+\d+(?:\.\d+)*[a-z]?\b/g,
  },
];

const INFRA_OR_TYPES = new Set([
  'ipv4',
  'ipv6',
  'mac',
  'mac-address',
  'internal-url',
  'hostname-internal',
  'azure-resource-id',
  'aws-arn',
  'device-uuid',
  'device-id-tag',
  'tech-version',
]);

function isInfraType(type: string): boolean {
  return INFRA_OR_TYPES.has(type);
}

export function matchInfra(input: string): PatternMatch[] {
  return runPatterns(input, INFRA_PATTERNS);
}

export async function matchInfraEnhanced(
  input: string,
  opts?: { filters?: readonly import('./or-filters/types.js').OrPostFilter[] },
): Promise<PatternMatch[]> {
  const local = matchInfra(input);

  let orHits: PatternMatch[];
  try {
    const all = await detectWithOpenRedaction(input, { filters: opts?.filters as never });
    orHits = all.filter((h) => isInfraType(h.type));
  } catch (err) {
    if (process.env.DEBUG) console.warn('[ainonymous] openredaction error:', err);
    return local;
  }

  return mergeMatches(local, orHits);
}
