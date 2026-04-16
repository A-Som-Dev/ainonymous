import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import yaml from 'js-yaml';
import { loadConfig } from '../config/loader.js';
import { GlossaryManager } from '../glossary/manager.js';
import { scanForIdentifiers } from '../glossary/scanner.js';

const CONFIG_FILE = '.ainonymity.yml';
const TERM_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TERM_MAX_LEN = 100;

export function validateGlossaryTerm(term: string): void {
  if (!term || !term.trim()) {
    throw new Error('invalid term: empty');
  }
  if (term.length > TERM_MAX_LEN) {
    throw new Error(`invalid term: too long (${term.length} > ${TERM_MAX_LEN})`);
  }
  if (!TERM_PATTERN.test(term)) {
    throw new Error('invalid term: only [a-zA-Z0-9_-] allowed');
  }
}

export function resolveConfigPath(dir: string, configFile: string = CONFIG_FILE): string {
  const baseResolved = resolve(dir);
  const configPath = resolve(baseResolved, configFile);
  if (!configPath.startsWith(baseResolved)) {
    throw new Error(`path traversal detected: ${configFile} resolves outside ${baseResolved}`);
  }
  return configPath;
}

export function registerGlossaryCmd(program: Command): void {
  const glossary = program.command('glossary').description('Manage domain term glossary');

  glossary
    .command('add <term>')
    .description('Add a domain term to the glossary')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .action((term: string, opts: { dir: string }) => {
      try {
        validateGlossaryTerm(term);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }

      let configPath: string;
      try {
        configPath = resolveConfigPath(opts.dir);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }

      if (!existsSync(configPath)) {
        console.error(`No ${CONFIG_FILE} found. Run "ainonymous init" first.`);
        process.exit(1);
      }

      const raw = readFileSync(configPath, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown>;

      const code = (parsed.code ?? {}) as Record<string, unknown>;
      const terms = Array.isArray(code.domain_terms) ? (code.domain_terms as string[]) : [];

      if (terms.includes(term)) {
        console.log(`"${term}" is already in the glossary`);
        return;
      }

      terms.push(term);
      code.domain_terms = terms;
      parsed.code = code;

      writeFileSync(configPath, yaml.dump(parsed, { lineWidth: 100, noRefs: true }), 'utf-8');
      console.log(`Added "${term}" to domain terms`);
    });

  glossary
    .command('list')
    .description('List all domain terms')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .action((opts: { dir: string }) => {
      const config = loadConfig(opts.dir);
      const terms = config.code.domainTerms;

      if (terms.length === 0) {
        console.log('No domain terms configured');
        return;
      }

      console.log(`Domain terms (${terms.length}):`);
      for (const t of terms.sort()) {
        console.log(`  ${t}`);
      }
    });

  glossary
    .command('suggest')
    .description('Scan project and suggest new domain terms')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .option('--limit <number>', 'max identifiers to scan', '500')
    .action(async (opts: { dir: string; limit: string }) => {
      const config = loadConfig(opts.dir);
      const manager = new GlossaryManager(config.code.domainTerms, config.code.preserve);
      const limit = parseInt(opts.limit, 10);

      console.log('Scanning project for identifiers...');
      const identifiers = await scanForIdentifiers(opts.dir, limit);
      const suggestions = manager.suggest(identifiers);

      if (suggestions.length === 0) {
        console.log('No new terms found');
        return;
      }

      console.log(`Suggested terms (${suggestions.length}):`);
      for (const s of suggestions) {
        console.log(`  ${s}`);
      }
      console.log(`\nAdd with: ainonymous glossary add <term>`);
    });
}
