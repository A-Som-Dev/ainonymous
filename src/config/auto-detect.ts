import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { AInonymousConfig } from '../types.js';
import { DEFAULT_CONFIG } from './schema.js';

const FREE_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.de',
  'yandex.com',
  'yandex.ru',
  'protonmail.com',
  'proton.me',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'aol.de',
  'web.de',
  'gmx.de',
  'gmx.net',
  'gmx.com',
  'posteo.de',
  'mailbox.org',
  't-online.de',
  'freenet.de',
  'arcor.de',
  'mail.com',
  'mail.ru',
  'zoho.com',
  'fastmail.com',
  // pseudo-domains that don't identify a company
  'users.noreply.github.com',
  'noreply.github.com',
  'users.noreply.gitlab.com',
]);

// Framework / language / build-tool terms that show up in artifactIds, package
// names, and file paths but carry no company-specific meaning. Keeping them out
// of domain_terms avoids matching thousands of irrelevant identifiers.
const FRAMEWORK_STOPLIST = new Set(
  [
    // java / jvm
    'java',
    'kotlin',
    'scala',
    'groovy',
    'spring',
    'boot',
    'starter',
    'core',
    'parent',
    'child',
    'common',
    'commons',
    'utils',
    'util',
    'tools',
    'lib',
    'libs',
    'api',
    'sdk',
    'web',
    'rest',
    'data',
    'security',
    'cloud',
    'actuator',
    'test',
    'tests',
    'integration',
    'jpa',
    'jdbc',
    'hibernate',
    'lombok',
    'jackson',
    'slf4j',
    'logback',
    'log4j',
    'junit',
    'mockito',
    'assertj',
    'quarkus',
    'micronaut',
    'vaadin',
    'camunda',
    'kafka',
    'confluent',
    'connect',
    'connector',
    'debezium',
    'liquibase',
    'flyway',
    'reactor',
    'netty',
    'tomcat',
    'jetty',
    'undertow',
    'mongo',
    'mongodb',
    'redis',
    'postgres',
    'postgresql',
    'mariadb',
    'mysql',
    'oracle',
    'h2',
    'elasticsearch',
    'rabbitmq',
    'zookeeper',
    'keycloak',
    'wiremock',
    'testcontainers',
    'micrometer',
    'prometheus',
    'grafana',
    'opentelemetry',
    'zipkin',
    'jaeger',
    // js / ts / node
    'node',
    'express',
    'react',
    'next',
    'nextjs',
    'nuxt',
    'vue',
    'angular',
    'svelte',
    'vite',
    'webpack',
    'rollup',
    'babel',
    'tsc',
    'eslint',
    'prettier',
    'typescript',
    'javascript',
    'yarn',
    'pnpm',
    'bun',
    'deno',
    'npm',
    'tsx',
    'jsx',
    // python
    'python',
    'pip',
    'venv',
    'poetry',
    'django',
    'flask',
    'fastapi',
    'celery',
    'numpy',
    'pandas',
    'torch',
    'tensorflow',
    'sklearn',
    'pytest',
    // go / rust
    'golang',
    'gin',
    'echo',
    'cargo',
    'tokio',
    'serde',
    'axum',
    'actix',
    // devops / containers
    'docker',
    'compose',
    'helm',
    'chart',
    'kubernetes',
    'k8s',
    'openshift',
    'terraform',
    'ansible',
    // generic technical
    'server',
    'client',
    'service',
    'services',
    'controller',
    'repository',
    'model',
    'view',
    'component',
    'config',
    'configuration',
    'factory',
    'builder',
    'handler',
    'manager',
    'provider',
    'consumer',
    'producer',
    'worker',
    'job',
    'task',
    'queue',
    'adapter',
    'wrapper',
    'proxy',
    'gateway',
    'middleware',
    'module',
    'package',
    'project',
    'app',
    'application',
    'main',
    'base',
    'abstract',
    'default',
    'generic',
    'helper',
    'support',
    'shared',
    'listener',
    'management',
    'monitoring',
    'metrics',
    'health',
    'dev',
    'prod',
    'stage',
    'demo',
    'sample',
    'example',
    'tutorial',
    'playground',
    // generic english words (data, node already above)
    'name',
    'type',
    'info',
    'meta',
    'value',
    'result',
    'error',
    'event',
    'item',
    'list',
    'entry',
    'record',
    'report',
    'stats',
    'status',
    'state',
    'flag',
    'mode',
    'option',
  ].map((t) => t.toLowerCase()),
);

function isFrameworkTerm(term: string): boolean {
  return FRAMEWORK_STOPLIST.has(term.toLowerCase());
}

function git(dir: string, args: string[]): string {
  // Block RCE via a malicious .git/config (core.fsmonitor, core.hookspath,
  // core.sshCommand). Every git call from init/doctor/scan goes through here.
  const hardened = [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.hookspath=/dev/null',
    '-c',
    'core.sshCommand=false',
    '-c',
    'protocol.allow=user',
    ...args,
  ];
  try {
    return execFileSync('git', hardened, {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch {
    return '';
  }
}

// Well-known parent-pom groupIds that do NOT identify the project itself.
// Needed when a submodule inherits its groupId from a framework BOM.
const BOM_GROUP_PREFIXES = [
  'org.springframework',
  'org.apache',
  'io.quarkus',
  'com.google',
  'io.micronaut',
  'org.jboss',
  'io.micrometer',
  'jakarta.',
  'javax.',
  'com.fasterxml',
  'org.sonatype',
];

function isBomGroup(g: string): boolean {
  return BOM_GROUP_PREFIXES.some((p) => g.startsWith(p));
}

function extractGroupIdDomain(dir: string): { company: string; domain: string } | null {
  // Java convention: groupId follows reverse-domain notation. de.acme =>
  // acme.de. Strip the <parent>...</parent> block first, its groupId
  // usually points at a BOM (e.g. org.springframework.boot).
  const pomPath = join(dir, 'pom.xml');
  if (!existsSync(pomPath)) return null;
  try {
    const raw = readFileSync(pomPath, 'utf-8');
    const withoutParent = raw.replace(/<parent>[\s\S]*?<\/parent>/gi, '');
    let group = withoutParent.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1];

    // Maven submodule: no local <groupId>, inherits from parent. Fall back to
    // the parent's groupId. but only if it doesn't look like a BOM/framework.
    if (!group) {
      const parent = raw.match(
        /<parent>[\s\S]*?<groupId>\s*([^<\s]+)\s*<\/groupId>[\s\S]*?<\/parent>/,
      );
      if (parent && !isBomGroup(parent[1])) group = parent[1];
    }

    if (!group) return null;
    // Sanitize: strict reverse-domain identifier segments. Blocks malicious
    // pom.xml payloads like <groupId>../etc/passwd</groupId> from landing as
    // a company/domain-term and pseudonymising unrelated strings in the repo.
    const SEGMENT = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    const segments = group.split('.').filter(Boolean);
    if (segments.length < 2) return null;
    if (!segments.every((s) => SEGMENT.test(s) && s.length <= 64)) return null;
    const [tld, comp] = segments;
    if (comp.length < 2) return null;
    return { company: comp, domain: `${comp}.${tld}` };
  } catch {
    return null;
  }
}

function detectCompany(dir: string): { company: string; domains: string[] } {
  const email = git(dir, ['config', 'user.email']);
  const groupInfo = extractGroupIdDomain(dir);

  if (!email || !email.includes('@')) {
    if (groupInfo) return { company: groupInfo.company, domains: [groupInfo.domain] };
    return { company: '', domains: [] };
  }

  const emailDomain = email.split('@')[1];
  const emailIsFree = FREE_PROVIDERS.has(emailDomain) || /^\d+\+.+@(users\.)?noreply\./.test(email);

  if (emailIsFree) {
    if (groupInfo) return { company: groupInfo.company, domains: [groupInfo.domain] };
    return { company: '', domains: [] };
  }

  const parts = emailDomain.split('.');
  const company = parts.length >= 2 ? parts[parts.length - 2] : parts[0];

  // Merge in groupId-derived domain if it differs (common for contractors
  // committing from a personal @contractor.io email into a @acme.de project).
  const domains = [emailDomain];
  if (groupInfo && groupInfo.domain !== emailDomain && !domains.includes(groupInfo.domain)) {
    domains.push(groupInfo.domain);
  }
  return { company, domains };
}

function cleanPersonName(raw: string): string {
  // Strip trailing "(USER.NAME DOMAIN.TLD)" or "(UPPERCASE)" author-suffixes
  // that git-log produces when a git identity is set per machine. Also drop
  // generic trailing tags in square brackets or parens.
  let out = raw.replace(/\s*\(\s*[A-Z][^()]*\)\s*$/, '').trim();
  out = out.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  // collapse repeated whitespace
  out = out.replace(/\s+/g, ' ');
  return out;
}

function detectPeople(dir: string): string[] {
  const raw = git(dir, ['log', '--format=%aN', '--max-count=500']);
  if (!raw) return [];
  const seen = new Map<string, string>();
  for (const rawName of raw.split('\n')) {
    const cleaned = cleanPersonName(rawName);
    if (!cleaned) continue;
    if (/\bbot\b/i.test(cleaned)) continue;
    if (/\bbuild\b/i.test(cleaned) && /\bservice\b/i.test(cleaned)) continue;
    if (!cleaned.includes(' ')) continue;
    // Dedup key ignores word order so "Großmann Peter" and "Peter Großmann"
    // collapse into a single entry. Git authors often flip between the two
    // formats depending on the machine the commit was made on.
    const words = cleaned.toLowerCase().split(/\s+/).sort();
    const key = words.join(' ');
    if (!seen.has(key)) seen.set(key, cleaned);
  }
  return [...seen.values()];
}

function detectLanguageAt(dir: string): string | null {
  if (existsSync(join(dir, 'pom.xml'))) return 'java';
  if (existsSync(join(dir, 'build.gradle.kts'))) return 'kotlin';
  if (existsSync(join(dir, 'build.gradle'))) return 'java';
  if (existsSync(join(dir, 'go.mod'))) return 'go';
  if (existsSync(join(dir, 'Cargo.toml'))) return 'rust';
  if (
    existsSync(join(dir, 'pyproject.toml')) ||
    existsSync(join(dir, 'setup.py')) ||
    existsSync(join(dir, 'requirements.txt'))
  )
    return 'python';
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return deps['typescript'] ? 'typescript' : 'javascript';
    } catch {
      /* fall through */
    }
  }
  return null;
}

function collectFromPyproject(dir: string, out: string[]): void {
  const p = join(dir, 'pyproject.toml');
  if (!existsSync(p)) return;
  try {
    const raw = readFileSync(p, 'utf-8');
    // Minimal parser for `[project]\nname = "..."`. Avoids a TOML dep for a
    // single field lookup; legitimate nested tables are ignored.
    const match = raw.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (match) pushAliasCandidates(match[1], out);
  } catch {
    /* ignore */
  }
}

function collectFromSetupPy(dir: string, out: string[]): void {
  const p = join(dir, 'setup.py');
  if (!existsSync(p)) return;
  try {
    const raw = readFileSync(p, 'utf-8');
    const match = raw.match(/name\s*=\s*["']([^"']+)["']/);
    if (match) pushAliasCandidates(match[1], out);
  } catch {
    /* ignore */
  }
}

function collectFromReadme(dir: string, out: string[]): void {
  for (const name of ['README.md', 'README.MD', 'Readme.md', 'readme.md']) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf-8');
      const h1 = raw.match(/^#\s+([^\n]+)/m);
      if (!h1) return;
      // README titles often contain company name + tagline; only take the
      // first word-ish token so a line like "# acme-corp internal tooling"
      // contributes just `acme-corp`.
      const first = h1[1].trim().split(/\s+/)[0];
      pushAliasCandidates(first.replace(/[^\w-]/g, ''), out);
    } catch {
      /* ignore */
    }
    return;
  }
}

function collectFromGitRemote(dir: string, out: string[]): void {
  // Route through the hardened git() wrapper so a malicious .git/config in the
  // target repo cannot hijack this one call via fsmonitor / sshCommand tricks.
  const url = git(dir, ['remote', 'get-url', 'origin']);
  if (!url) return;
  const match = url.match(/[/:]([^/:]+?)\/([^/]+?)(?:\.git)?\/?$/);
  if (match) {
    pushAliasCandidates(match[2], out);
  }
}

function pushAliasCandidates(raw: string, out: string[]): void {
  const name = raw.trim();
  if (!name) return;
  if (name.length > 3) out.push(name);
  for (const part of name.split(/[-_]/)) {
    if (part.length > 2 && part !== name) out.push(part);
  }
}

function detectLanguage(dir: string): string {
  const rootGuess = detectLanguageAt(dir);
  if (rootGuess) return rootGuess;

  // Monorepo: docker-compose-only root, language lives in a subdir like
  // backend/, api/, server/, services/, src/. Probe common layouts.
  for (const sub of ['backend', 'api', 'server', 'services', 'src']) {
    const subDir = join(dir, sub);
    if (!existsSync(subDir)) continue;
    const guess = detectLanguageAt(subDir);
    if (guess) return guess;
  }

  // Infrastructure-only repos (just yaml/helm/terraform) don't have a source
  // language. Fall back to 'unknown' so the config doesn't falsely claim
  // typescript. identifier-pseudonymisation passes become no-ops and the
  // user can override if needed.
  return 'unknown';
}

function capitalize(word: string): string {
  return word[0].toUpperCase() + word.slice(1);
}

function detectDomainTerms(dir: string, company: string): string[] {
  const candidates: string[] = [];

  // Full kebab-case slug (`acme-line-mgmt-kafka`) as a single
  // domain term so a prose mention of the repo name gets pseudonymized as
  // a unit, not just the >2-char segments.
  const slug = basename(dir);
  if (/[-_]/.test(slug) && slug.length > 3) candidates.push(slug);

  const dirParts = slug
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2);
  candidates.push(...dirParts);

  const pomPath = join(dir, 'pom.xml');
  if (existsSync(pomPath)) {
    try {
      const pom = readFileSync(pomPath, 'utf-8');
      const artifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
      if (artifact) candidates.push(...artifact[1].split(/[-_]/).filter((w) => w.length > 2));
    } catch {
      /* ignore */
    }
  }

  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (typeof pkg.name === 'string') {
        const cleaned = pkg.name.replace(/^@[^/]+\//, '');
        if (cleaned.length > 3 && /[-_]/.test(cleaned)) candidates.push(cleaned);
        candidates.push(...cleaned.split(/[-_]/).filter((w: string) => w.length > 2));
      }
    } catch {
      /* ignore */
    }
  }

  collectFromPyproject(dir, candidates);
  collectFromSetupPy(dir, candidates);
  collectFromReadme(dir, candidates);
  collectFromGitRemote(dir, candidates);

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of candidates) {
    const lower = raw.toLowerCase();
    if (lower === company.toLowerCase()) continue;
    if (isFrameworkTerm(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    // Preserve kebab-case / snake_case slugs as-is. Only capitalise single
    // word tokens so `customer` becomes `Customer` but
    // `acme-line-mgmt-kafka` stays a full slug the domain-term
    // matcher can recognise in prose mentions.
    terms.push(/[-_]/.test(raw) ? raw : capitalize(raw));
  }
  return terms;
}

export function autoDetect(dir: string): AInonymousConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  const { company, domains } = detectCompany(dir);

  config.identity.company = company;
  config.identity.domains = domains;
  config.identity.people = detectPeople(dir);
  config.code.language = detectLanguage(dir);
  config.code.domainTerms = detectDomainTerms(dir, company);
  config.code.sensitivePaths = ['.env', '.env.*', '**/*.pem', '**/*.key'];

  return config;
}
