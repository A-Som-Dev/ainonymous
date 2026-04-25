import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { initParser } from '../ast/extractor.js';
import type { Replacement } from '../types.js';

export function registerPreviewCmd(program: Command): void {
  program
    .command('preview')
    .description('Run the anonymization pipeline offline against a file or stdin')
    .option('--input-file <path>', 'read from a file instead of stdin')
    .option('--json', 'emit JSON ({ text, replacements }) instead of human-readable text')
    .action(async (opts: { inputFile?: string; json?: boolean }) => {
      const input = opts.inputFile ? readFileSync(opts.inputFile, 'utf-8') : await readStdin();
      if (input.length === 0) {
        console.error('preview: no input. Pipe text into stdin or pass --input-file.');
        process.exit(1);
      }

      await initParser();
      const config = loadConfig(process.cwd());
      const pipeline = new Pipeline(config);
      await pipeline.loadConfiguredCustomFilters(process.cwd());
      const result = await pipeline.anonymize(input, opts.inputFile);

      if (opts.json) {
        // Strip `original` so `preview --json` never writes plaintext PII or
        // secrets onto stdout (CI logs, clipboards, pipes). Pseudonym and
        // range are sufficient for downstream tooling.
        const safe = result.replacements.map(({ original: _original, ...rest }) => rest);
        console.log(JSON.stringify({ text: result.text, replacements: safe }, null, 2));
        return;
      }

      console.log(result.text);
      console.error(`\n--- findings (${result.replacements.length}) ---`);
      for (const r of byLayer(result.replacements)) {
        console.error(formatReplacement(r));
      }
    });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => resolve(''));
  });
}

function byLayer(rs: Replacement[]): Replacement[] {
  const order = { secrets: 0, identity: 1, code: 2 } as Record<string, number>;
  return [...rs].sort(
    (a, b) => (order[a.layer] ?? 9) - (order[b.layer] ?? 9) || a.offset - b.offset,
  );
}

function formatReplacement(r: Replacement): string {
  return `[${r.layer}]  ${r.type}  @${r.offset}+${r.length}  "${r.pseudonym}"`;
}
