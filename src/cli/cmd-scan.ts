import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { AuditLogger } from '../audit/logger.js';
import { createProxyServer } from '../proxy/server.js';
import { listenWithFallback } from './listen-with-fallback.js';
import { SKIP_DIRS } from '../shared.js';

const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.sh',
  '.bash',
  '.zsh',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.md',
  '.txt',
  '.properties',
  '.xml',
  '.gradle',
  '.kts',
]);

const DOTENV_RE = /^\.env(\..+)?$/;

export function registerScanCmd(program: Command): void {
  program
    .command('scan')
    .description('Dry run: show what would be anonymized')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .option('--limit <number>', 'max files to scan', '50')
    .option('-v, --verbose', 'show pseudonyms in output')
    .option('--dashboard', 'show live dashboard during scan')
    .action(
      async (opts: { dir: string; limit: string; verbose?: boolean; dashboard?: boolean }) => {
        const limit = parseInt(opts.limit, 10);
        const config = loadConfig(opts.dir);
        const logger = new AuditLogger();
        const pipeline = new Pipeline(config, logger);

        let dashServer: ReturnType<typeof createProxyServer> | null = null;
        if (opts.dashboard) {
          dashServer = createProxyServer({ config, logger, pipeline });
          const port = await listenWithFallback(dashServer, config.behavior.port, '127.0.0.1');
          console.log(`Dashboard: http://127.0.0.1:${port}/dashboard`);
        }

        const files = collectFiles(opts.dir, limit);
        let totalFindings = 0;
        let filesWithFindings = 0;

        for (const filePath of files) {
          const content = readSafe(filePath);
          if (!content) continue;

          const rel = relative(opts.dir, filePath);
          const result = await pipeline.anonymize(content, rel);
          if (result.replacements.length === 0) continue;

          filesWithFindings++;
          totalFindings += result.replacements.length;

          console.log(`\n${rel} (${result.replacements.length} findings)`);
          for (const r of result.replacements) {
            const suffix = opts.verbose ? ` → "${r.pseudonym}"` : '';
            console.log(`  [${r.layer}/${r.type}] (${r.original.length} chars)${suffix}`);
          }
        }

        console.log(`\n--- Scan Summary ---`);
        console.log(`Files scanned: ${files.length}`);
        console.log(`Files with findings: ${filesWithFindings}`);
        console.log(`Total findings: ${totalFindings}`);
        console.log(
          `Session map: ${pipeline.getSessionMap().size} unique pseudonyms (shared across files)`,
        );

        if (dashServer) {
          console.log('\nDashboard still running. Press Ctrl+C to stop.');
          await new Promise(() => {}); // keep alive
        }
      },
    );
}

function collectFiles(dir: string, limit: number): string[] {
  const result: string[] = [];

  function walk(current: string): void {
    if (result.length >= limit) return;

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (result.length >= limit) return;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(join(current, entry.name));
        }
        continue;
      }

      if (entry.isFile()) {
        const name = entry.name;
        const ext = extname(name).toLowerCase();
        if (SOURCE_EXTS.has(ext) || DOTENV_RE.test(name)) {
          result.push(join(current, name));
        }
      }
    }
  }

  walk(dir);
  return result;
}

function readSafe(filePath: string): string | null {
  try {
    const stat = statSync(filePath);
    if (stat.size > 512 * 1024) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
