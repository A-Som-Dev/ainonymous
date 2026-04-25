import { resolve } from 'node:path';
import type { Command } from 'commander';
import { BUILT_IN_OR_FILTERS, selectFilters } from '../patterns/or-filters/index.js';
import { loadCustomFilters } from '../patterns/or-filters/loader.js';
import { loadConfig } from '../config/loader.js';

export function registerFiltersCmd(program: Command): void {
  const filters = program.command('filters').description('Inspect and validate or-filter chain');

  filters
    .command('list')
    .description('Print the effective or-filter chain')
    .action(() => {
      const cfg = loadConfig(process.cwd());
      const disable = cfg.filters?.disable ?? [];
      const chain = selectFilters({ disable }, BUILT_IN_OR_FILTERS);
      console.log(`${chain.length} active filter(s) (disabled: ${disable.length || 'none'}):`);
      for (const f of chain) {
        const desc = f.description ?? '(no description)';
        console.log(`  ${f.id}`);
        console.log(`    ${desc}`);
      }
      if (disable.length > 0) {
        console.log(`\nDisabled in .ainonymous.yml filters.disable: ${disable.join(', ')}`);
      }
    });

  filters
    .command('validate <path>')
    .description('Load a custom .mjs filter, run shape checks, do not register it')
    .action(async (path: string) => {
      const abs = resolve(process.cwd(), path);
      try {
        const loaded = await loadCustomFilters(
          [{ path: abs, allowUnsignedLocal: true }],
          process.cwd(),
        );
        for (const { filter } of loaded) {
          console.log(`ok ${filter.id}`);
          if (filter.description) console.log(`   ${filter.description}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
