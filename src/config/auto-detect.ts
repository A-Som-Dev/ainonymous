import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { AInonymityConfig } from '../types.js';
import { DEFAULT_CONFIG } from './schema.js';

const FREE_PROVIDERS = new Set([
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'protonmail.com',
  'icloud.com',
  'web.de',
  'gmx.de',
  'gmx.net',
  'posteo.de',
  'mailbox.org',
  // pseudo-domains that don't identify a company
  'users.noreply.github.com',
  'noreply.github.com',
  'users.noreply.gitlab.com',
]);

function git(dir: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

function detectCompany(dir: string): { company: string; domains: string[] } {
  const email = git(dir, ['config', 'user.email']);
  if (!email || !email.includes('@')) return { company: '', domains: [] };

  const domain = email.split('@')[1];
  if (FREE_PROVIDERS.has(domain)) return { company: '', domains: [] };
  // handle "123+user@users.noreply.github.com" and similar noreply patterns
  if (/^\d+\+.+@(users\.)?noreply\./.test(email)) return { company: '', domains: [] };

  const parts = domain.split('.');
  const company = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return { company, domains: [domain] };
}

function detectPeople(dir: string): string[] {
  const raw = git(dir, ['log', '--format=%aN', '--max-count=500']);
  if (!raw) return [];
  const names = [...new Set(raw.split('\n').filter(Boolean))];
  return names.filter((n) => !n.toLowerCase().includes('bot') && n.includes(' '));
}

function detectLanguage(dir: string): string {
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
  return 'typescript';
}

function detectDomainTerms(dir: string, company: string): string[] {
  const terms: string[] = [];
  const name = basename(dir)
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && w.toLowerCase() !== company.toLowerCase())
    .map((w) => w[0].toUpperCase() + w.slice(1));
  terms.push(...name);

  // extract from pom.xml artifactId / groupId
  const pomPath = join(dir, 'pom.xml');
  if (existsSync(pomPath)) {
    try {
      const pom = readFileSync(pomPath, 'utf-8');
      const artifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
      if (artifact) {
        const parts = artifact[1].split(/[-_]/).filter((w) => w.length > 2);
        for (const p of parts) terms.push(p[0].toUpperCase() + p.slice(1));
      }
    } catch {
      /* ignore */
    }
  }

  // extract from package.json name
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (typeof pkg.name === 'string') {
        const cleaned = pkg.name.replace(/^@[^/]+\//, '');
        const parts = cleaned.split(/[-_]/).filter((w: string) => w.length > 2);
        for (const p of parts) terms.push(p[0].toUpperCase() + p.slice(1));
      }
    } catch {
      /* ignore */
    }
  }

  return [...new Set(terms)];
}

export function autoDetect(dir: string): AInonymityConfig {
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
