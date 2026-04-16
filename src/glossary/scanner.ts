import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { SKIP_DIRS } from '../shared.js';

const CODE_EXTENSIONS = new Set([
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
  '.cs',
  '.swift',
]);

const PASCAL_RE = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;

async function walkDir(dir: string, limit: number, collected: Set<string>): Promise<void> {
  if (collected.size >= limit) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (collected.size >= limit) break;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDir(join(dir, entry.name), limit, collected);
    } else if (CODE_EXTENSIONS.has(extname(entry.name))) {
      try {
        const content = await readFile(join(dir, entry.name), 'utf-8');
        for (const match of content.matchAll(PASCAL_RE)) {
          collected.add(match[1]);
          if (collected.size >= limit) break;
        }
      } catch {
        // unreadable file, skip
      }
    }
  }
}

export async function scanForIdentifiers(dir: string, limit = 500): Promise<string[]> {
  const found = new Set<string>();
  await walkDir(dir, limit, found);
  return [...found].sort();
}
