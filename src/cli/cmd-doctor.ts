import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import type { Command } from 'commander';
import { validateRawConfig, hasErrors } from '../config/validate.js';
import { parseCheckpoint } from '../audit/logger.js';
import yaml from 'js-yaml';

interface Check {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
}

export function registerDoctorCmd(program: Command): void {
  program
    .command('doctor')
    .description('Validate environment, config and port availability before first start')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .option('--strict', 'exit non-zero on warnings too (for CI gates)')
    .option('--force', 'ignore identity-coverage warnings and exit 0')
    .action(async (opts: { dir: string; strict?: boolean; force?: boolean }) => {
      const host = process.env['AINONYMOUS_HOST'] ?? '127.0.0.1';
      const checks: Check[] = [];
      checks.push(checkNodeVersion());
      checks.push(checkConfigFile(opts.dir));
      checks.push(...checkConfigIdentity(opts.dir));
      checks.push(checkSkipDirs(opts.dir));
      checks.push(checkLanguageOverride(opts.dir));
      checks.push(checkAuditCheckpoint(opts.dir));
      checks.push(await checkPort(resolvePort(opts.dir), host));
      checks.push(checkEnvUpstream());

      const width = Math.max(...checks.map((c) => c.label.length));
      let failed = 0;
      let warned = 0;
      let piiWarned = 0;
      for (const c of checks) {
        const icon = c.status === 'ok' ? '✔' : c.status === 'warn' ? '!' : '✘';
        console.log(`  ${icon}  ${c.label.padEnd(width)}  ${c.detail ?? ''}`);
        if (c.status === 'fail') failed++;
        if (c.status === 'warn') {
          warned++;
          if (c.label.startsWith('identity.')) piiWarned++;
        }
      }
      const piiGate = piiWarned > 0 && !opts.force;
      if (failed > 0 || piiGate || (opts.strict && warned > 0)) {
        let reason: string;
        if (failed > 0) reason = `${failed} failed`;
        else if (piiGate)
          reason = `${piiWarned} identity coverage warning(s). PII will likely leak. rerun with --force to proceed anyway`;
        else reason = `${warned} warning(s) under --strict`;
        console.log(`\n${reason}. Fix the entries above before running start.`);
        process.exit(1);
      } else {
        console.log('\nAll checks passed. Run `ainonymous start --open` to begin.');
      }
    });
}

function checkNodeVersion(): Check {
  const match = process.version.match(/^v(\d+)\.(\d+)/);
  if (!match) return { label: 'node version', status: 'warn', detail: process.version };
  const major = parseInt(match[1], 10);
  if (major < 22) {
    return { label: 'node version', status: 'fail', detail: `${process.version}. need ≥ 22.5` };
  }
  return { label: 'node version', status: 'ok', detail: process.version };
}

function checkConfigFile(dir: string): Check {
  const p = join(dir, '.ainonymous.yml');
  if (!existsSync(p)) {
    return {
      label: '.ainonymous.yml',
      status: 'warn',
      detail: 'missing. run `ainonymous init` first',
    };
  }
  try {
    const raw = yaml.load(readFileSync(p, 'utf-8'));
    if (!raw || typeof raw !== 'object') {
      return { label: '.ainonymous.yml', status: 'fail', detail: 'not a YAML object' };
    }
    const issues = validateRawConfig(raw as Record<string, unknown>);
    if (hasErrors(issues)) {
      const first = issues.find((i) => i.severity === 'error');
      return {
        label: '.ainonymous.yml',
        status: 'fail',
        detail: `${first?.path}: ${first?.message}`,
      };
    }
    return { label: '.ainonymous.yml', status: 'ok' };
  } catch (err) {
    return {
      label: '.ainonymous.yml',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkConfigIdentity(dir: string): Check[] {
  const p = join(dir, '.ainonymous.yml');
  if (!existsSync(p)) {
    return [{ label: 'identity coverage', status: 'warn', detail: 'no config yet' }];
  }
  try {
    const raw = yaml.load(readFileSync(p, 'utf-8')) as Record<string, unknown>;
    const identity = (raw?.identity ?? {}) as Record<string, unknown>;
    const company = typeof identity.company === 'string' ? identity.company : '';
    const domains = Array.isArray(identity.domains) ? identity.domains : [];
    const people = Array.isArray(identity.people) ? identity.people : [];

    const fields: Check[] = [];
    fields.push(
      company
        ? { label: 'identity.company', status: 'ok', detail: company }
        : { label: 'identity.company', status: 'warn', detail: 'empty. company names will leak' },
    );
    fields.push(
      domains.length > 0
        ? { label: 'identity.domains', status: 'ok', detail: `${domains.length} configured` }
        : {
            label: 'identity.domains',
            status: 'warn',
            detail: 'empty. internal hostnames and emails will leak',
          },
    );
    fields.push(
      people.length > 0
        ? { label: 'identity.people', status: 'ok', detail: `${people.length} configured` }
        : {
            label: 'identity.people',
            status: 'warn',
            detail: 'empty. author/reviewer names will leak',
          },
    );
    return fields;
  } catch {
    return [{ label: 'identity coverage', status: 'warn', detail: 'unreadable' }];
  }
}

function resolvePort(dir: string): number {
  const p = join(dir, '.ainonymous.yml');
  if (existsSync(p)) {
    try {
      const raw = yaml.load(readFileSync(p, 'utf-8')) as Record<string, unknown>;
      const behavior = (raw?.behavior ?? {}) as Record<string, unknown>;
      if (typeof behavior.port === 'number') return behavior.port;
    } catch {}
  }
  return 8100;
}

function checkPort(port: number, host: string): Promise<Check> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ label: `port ${port} @ ${host}`, status: 'fail', detail: 'already in use' });
      } else {
        resolve({ label: `port ${port} @ ${host}`, status: 'warn', detail: err.message });
      }
    });
    srv.once('listening', () => {
      srv.close(() => resolve({ label: `port ${port} @ ${host}`, status: 'ok', detail: 'free' }));
    });
    srv.listen(port, host);
  });
}

export function checkSkipDirs(dir: string): Check {
  const bare = join(dir, 'venv');
  if (existsSync(bare)) {
    return {
      label: 'skip dirs',
      status: 'warn',
      detail: '`venv/` present without dot prefix. Rename to `.venv/`.',
    };
  }
  return { label: 'skip dirs', status: 'ok' };
}

export function checkLanguageOverride(dir: string): Check {
  const cfgPath = join(dir, '.ainonymous.yml');
  if (!existsSync(cfgPath)) return { label: 'code.language', status: 'ok', detail: 'no config' };
  let raw: Record<string, unknown>;
  try {
    raw = yaml.load(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { label: 'code.language', status: 'ok', detail: 'config unreadable' };
  }
  const code = (raw.code ?? {}) as Record<string, unknown>;
  if (code.language !== 'unknown') {
    return { label: 'code.language', status: 'ok' };
  }
  const codeMarkers = [
    'pom.xml',
    'package.json',
    'go.mod',
    'Cargo.toml',
    'requirements.txt',
    'pyproject.toml',
    'setup.py',
    'build.gradle',
    'build.gradle.kts',
  ];
  for (const marker of codeMarkers) {
    if (existsSync(join(dir, marker))) {
      return {
        label: 'code.language',
        status: 'warn',
        detail: `set to 'unknown' but ${marker} suggests source code is present. Layer-3 identifier anonymisation will be skipped.`,
      };
    }
  }
  return { label: 'code.language', status: 'ok', detail: 'unknown (no source markers found)' };
}

export function checkAuditCheckpoint(dir: string): Check {
  const cfgPath = join(dir, '.ainonymous.yml');
  if (!existsSync(cfgPath)) return { label: 'audit checkpoint', status: 'ok', detail: 'no config' };
  let raw: Record<string, unknown>;
  try {
    raw = yaml.load(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { label: 'audit checkpoint', status: 'ok', detail: 'config unreadable' };
  }
  const audit = (raw.audit ?? {}) as Record<string, unknown>;
  const persistDir = typeof audit.persist_dir === 'string' ? audit.persist_dir : undefined;
  if (!persistDir) {
    return { label: 'audit checkpoint', status: 'ok', detail: 'persistence not configured' };
  }
  const absDir =
    persistDir.startsWith('/') || /^[A-Za-z]:/.test(persistDir)
      ? persistDir
      : join(dir, persistDir);
  if (!existsSync(absDir)) {
    return { label: 'audit checkpoint', status: 'ok', detail: 'audit dir not yet created' };
  }
  let driftFile: string | null = null;
  try {
    const entries = readdirSync(absDir).filter((f) => f.endsWith('.jsonl'));
    for (const f of entries) {
      const jsonlPath = join(absDir, f);
      const ckptPath = jsonlPath + '.checkpoint';
      if (!existsSync(ckptPath)) continue;
      const tailSeq = lastJsonlSeq(jsonlPath);
      if (tailSeq === null) continue;
      const ckpt = parseCheckpoint(readFileSync(ckptPath, 'utf-8'));
      if (ckpt === null) continue;
      if (ckpt.lastSeq < tailSeq) {
        driftFile = f;
        break;
      }
    }
  } catch {
    /* audit verify --strict is the authoritative check */
  }
  if (driftFile) {
    return {
      label: 'audit checkpoint',
      status: 'warn',
      detail: `${driftFile}: checkpoint behind jsonl tail. Run \`ainonymous audit verify --strict\``,
    };
  }
  return { label: 'audit checkpoint', status: 'ok', detail: absDir };
}

function lastJsonlSeq(path: string): number | null {
  try {
    const lines = readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    if (lines.length === 0) return null;
    const last = JSON.parse(lines[lines.length - 1]) as { seq?: unknown };
    return typeof last.seq === 'number' && Number.isInteger(last.seq) ? last.seq : null;
  } catch {
    return null;
  }
}

function checkEnvUpstream(): Check {
  const a = process.env['AINONYMOUS_UPSTREAM_ANTHROPIC'];
  const o = process.env['AINONYMOUS_UPSTREAM_OPENAI'];
  if (!a && !o) return { label: 'upstream override', status: 'ok', detail: 'defaults' };
  const parts: string[] = [];
  if (a) parts.push(`anthropic=${a}`);
  if (o) parts.push(`openai=${o}`);
  return { label: 'upstream override', status: 'ok', detail: parts.join(' ') };
}
