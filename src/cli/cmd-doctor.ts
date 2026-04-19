import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import type { Command } from 'commander';
import { validateRawConfig, hasErrors } from '../config/validate.js';
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
    .action(async (opts: { dir: string; strict?: boolean }) => {
      const host = process.env['AINONYMOUS_HOST'] ?? '127.0.0.1';
      const checks: Check[] = [];
      checks.push(checkNodeVersion());
      checks.push(checkConfigFile(opts.dir));
      checks.push(...checkConfigIdentity(opts.dir));
      checks.push(await checkPort(resolvePort(opts.dir), host));
      checks.push(checkEnvUpstream());

      const width = Math.max(...checks.map((c) => c.label.length));
      let failed = 0;
      let warned = 0;
      for (const c of checks) {
        const icon = c.status === 'ok' ? '✔' : c.status === 'warn' ? '!' : '✘';
        console.log(`  ${icon}  ${c.label.padEnd(width)}  ${c.detail ?? ''}`);
        if (c.status === 'fail') failed++;
        if (c.status === 'warn') warned++;
      }
      if (failed > 0 || (opts.strict && warned > 0)) {
        const reason = failed > 0 ? `${failed} failed` : `${warned} warning(s) under --strict`;
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

function checkEnvUpstream(): Check {
  const a = process.env['AINONYMOUS_UPSTREAM_ANTHROPIC'];
  const o = process.env['AINONYMOUS_UPSTREAM_OPENAI'];
  if (!a && !o) return { label: 'upstream override', status: 'ok', detail: 'defaults' };
  const parts: string[] = [];
  if (a) parts.push(`anthropic=${a}`);
  if (o) parts.push(`openai=${o}`);
  return { label: 'upstream override', status: 'ok', detail: parts.join(' ') };
}
