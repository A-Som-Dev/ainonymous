import { Parser, Language } from 'web-tree-sitter';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let parserReady = false;
const languageCache = new Map<string, Language>();
const parserCache = new Map<string, Promise<Parser>>();

const WASM_NAMES: Record<string, string> = { csharp: 'c_sharp' };

function resolveWasmPath(lang: string): string {
  const wasmsDir = require.resolve('tree-sitter-wasms/package.json');
  const base = wasmsDir.replace(/package\.json$/, '');
  const wasmLang = WASM_NAMES[lang] ?? lang;
  return `${base}out/tree-sitter-${wasmLang}.wasm`;
}

export async function initTreeSitter(): Promise<void> {
  if (parserReady) return;
  await Parser.init();
  parserReady = true;
}

// one parser per language. tree-sitter-wasm parse() is synchronous so there's
// no intra-lang contention. Sharing a single parser across languages would
// require setLanguage() on every call, which races when two requests for
// different langs interleave across an await boundary.
export async function getParser(lang: string): Promise<Parser> {
  await initTreeSitter();

  const existing = parserCache.get(lang);
  if (existing) return existing;

  const pending = (async () => {
    const language = await getLanguage(lang);
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();

  parserCache.set(lang, pending);
  try {
    return await pending;
  } catch (err) {
    parserCache.delete(lang);
    throw err;
  }
}

export async function getLanguage(lang: string): Promise<Language> {
  const cached = languageCache.get(lang);
  if (cached) return cached;

  const wasmPath = resolveWasmPath(lang);
  const language = await Language.load(wasmPath);
  languageCache.set(lang, language);
  return language;
}

// test-only helper, do not rely on this in production code
export function __parserCacheSize(): number {
  return parserCache.size;
}
