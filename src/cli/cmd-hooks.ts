import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Command } from 'commander';
import { generateHookConfig } from '../hooks/cc-hooks.js';

export function registerHooksCmd(program: Command): void {
  const hooks = program.command('hooks').description('Manage Claude Code hook integration');

  hooks
    .command('install')
    .description('Install hooks into .claude/settings.json')
    .option('-p, --port <number>', 'proxy port', '8100')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .action((opts: { port: string; dir: string }) => {
      const port = parseInt(opts.port, 10);
      const settingsPath = join(opts.dir, '.claude', 'settings.json');

      let existing: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try {
          existing = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        } catch {
          console.error('Could not parse existing settings.json, creating fresh');
        }
      }

      const hookConfig = generateHookConfig(port);

      const existingHooks =
        existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
          ? (existing.hooks as Record<string, unknown>)
          : {};

      if (existingHooks['SessionStart']) {
        console.warn('Warning: overwriting existing hooks.SessionStart entry in settings.json');
      }

      const merged = {
        ...existing,
        hooks: { ...existingHooks, ...hookConfig.hooks },
      };

      const dir = dirname(settingsPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      console.log(`Hooks installed in ${settingsPath}`);
      console.log('  SessionStart: ensures proxy is running');
    });

  hooks
    .command('show')
    .description('Show current hook configuration')
    .option('-p, --port <number>', 'proxy port', '8100')
    .action((opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const config = generateHookConfig(port);
      console.log(JSON.stringify(config, null, 2));
    });
}
