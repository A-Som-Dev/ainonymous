import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import yaml from 'js-yaml';

const CONFIG_FILE = '.ainonymous.yml';

export function registerConfigCmd(program: Command): void {
  const cfg = program.command('config').description('Config maintenance commands');

  cfg
    .command('migrate')
    .description('Rewrite .ainonymous.yml against the current schema + explicit defaults')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .option('--in-place', 'overwrite the existing file instead of writing .ainonymous.yml.migrated')
    .option(
      '--keep-v1-aggression',
      'keep the pre-1.2 implicit aggression=high behaviour instead of accepting medium',
    )
    .action(async (opts: { dir: string; inPlace?: boolean; keepV1Aggression?: boolean }) => {
      const path = join(opts.dir, CONFIG_FILE);
      if (!existsSync(path)) {
        console.error(`No ${CONFIG_FILE} found in ${opts.dir}.`);
        process.exit(1);
      }

      const raw = readFileSync(path, 'utf-8');
      const parsed = yaml.load(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.error(`${CONFIG_FILE} is not a YAML object.`);
        process.exit(1);
      }

      const current = parsed as Record<string, unknown>;
      const fromVersion = typeof current.version === 'number' ? current.version : 0;

      const migrated = migrate(current, { keepV1Aggression: opts.keepV1Aggression ?? false });

      let wantAggressionPrompt = false;
      if (fromVersion < 1 || !hasExplicitAggression(current)) {
        wantAggressionPrompt = true;
      }

      if (wantAggressionPrompt && !opts.keepV1Aggression && process.stdin.isTTY) {
        const optOut = await promptYesNo(
          'v1.2 medium now pseudonymizes code identifiers (classes, methods, packages, types) ' +
            'in addition to identity/secrets. If you prefer the pre-v1.2 medium behaviour ' +
            '(compound domain_terms only, no AST obfuscation), answer yes to pin aggression=low. [y/N]: ',
        );
        if (optOut) {
          ((migrated.behavior ??= {}) as Record<string, unknown>).aggression = 'low';
        }
      }

      const out = yaml.dump(migrated, { lineWidth: 100, noRefs: true });
      const target = opts.inPlace ? path : `${path}.migrated`;
      if (opts.inPlace) {
        // Random suffix avoids collision if two migrate runs race within the
        // same millisecond. 0o600 keeps the backup readable only by the user
        //. the old config can carry Custom-Patterns with company identity.
        const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
        const backup = `${path}.backup-${suffix}`;
        renameSync(path, backup);
        try {
          chmodSync(backup, 0o600);
        } catch {
          // Windows filesystems without POSIX perms ignore this silently.
        }
      }
      writeFileSync(target, out, { encoding: 'utf-8', mode: 0o600 });

      console.log(`Migrated from v${fromVersion} -> v1 schema, wrote ${target}`);
      if (!opts.inPlace) {
        console.log(`Original left untouched. Diff, then: mv ${target} ${path}`);
      } else {
        console.log(
          'Backup of the previous config saved alongside with 0o600 perms. ' +
            'Check .gitignore (`.ainonymous.yml.backup-*` is already excluded).',
        );
      }
    });
}

interface MigrateOptions {
  keepV1Aggression: boolean;
}

function migrate(input: Record<string, unknown>, opts: MigrateOptions): Record<string, unknown> {
  const out: Record<string, unknown> = { version: 1 };

  out.secrets = shallowObject(input.secrets) ?? { patterns: [] };

  const identity = shallowObject(input.identity) ?? {};
  out.identity = {
    company: typeof identity.company === 'string' ? identity.company : '',
    domains: Array.isArray(identity.domains) ? identity.domains : [],
    people: Array.isArray(identity.people) ? identity.people : [],
  };

  const code = shallowObject(input.code) ?? {};
  out.code = {
    language: typeof code.language === 'string' ? code.language : 'unknown',
    domain_terms: Array.isArray(code.domain_terms) ? code.domain_terms : [],
    preserve: Array.isArray(code.preserve) ? code.preserve : [],
    sensitive_paths: Array.isArray(code.sensitive_paths) ? code.sensitive_paths : [],
    redact_bodies: Array.isArray(code.redact_bodies) ? code.redact_bodies : [],
  };

  const behavior = shallowObject(input.behavior) ?? {};
  const upstream = shallowObject(behavior.upstream) ?? {};
  out.behavior = {
    interactive: typeof behavior.interactive === 'boolean' ? behavior.interactive : true,
    audit_log: typeof behavior.audit_log === 'boolean' ? behavior.audit_log : true,
    dashboard: typeof behavior.dashboard === 'boolean' ? behavior.dashboard : true,
    aggression: resolveAggression(behavior.aggression, opts),
    port: typeof behavior.port === 'number' ? behavior.port : 8100,
    upstream: {
      anthropic:
        typeof upstream.anthropic === 'string' ? upstream.anthropic : 'https://api.anthropic.com',
      openai: typeof upstream.openai === 'string' ? upstream.openai : 'https://api.openai.com',
    },
    ...(typeof behavior.compliance === 'string' ? { compliance: behavior.compliance } : {}),
    ...(typeof behavior.mgmt_token === 'string' ? { mgmt_token: behavior.mgmt_token } : {}),
  };

  const session = shallowObject(input.session);
  if (session) out.session = session;

  const streaming = shallowObject(behavior.streaming);
  if (streaming && typeof streaming.eager_flush === 'boolean') {
    (out.behavior as Record<string, unknown>).streaming = {
      eager_flush: streaming.eager_flush,
    };
  }

  const filters = shallowObject(input.filters);
  if (filters) {
    out.filters = {
      disable: Array.isArray(filters.disable) ? filters.disable : [],
      custom: Array.isArray(filters.custom) ? filters.custom : [],
    };
  }

  const trust = shallowObject(input.trust);
  if (trust) {
    out.trust = {
      allow_unsigned_local: trust.allow_unsigned_local === true,
    };
  }

  return out;
}

function resolveAggression(value: unknown, opts: MigrateOptions): string {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return opts.keepV1Aggression ? 'high' : 'medium';
}

function hasExplicitAggression(input: Record<string, unknown>): boolean {
  const behavior = shallowObject(input.behavior);
  if (!behavior) return false;
  const a = behavior.aggression;
  return a === 'low' || a === 'medium' || a === 'high';
}

function shallowObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
