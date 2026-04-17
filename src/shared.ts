/** Decode a file buffer to string while honouring UTF-16 LE/BE and UTF-8 BOMs.
 *  Tools like Windows Excel and some PowerShell variants export UTF-16; if we
 *  read those as utf-8 the pattern matchers see mojibake and silently return
 *  zero findings. a dangerous false negative. Reading past the BOM into the
 *  right encoding makes the content scan-able. */
export function decodeWithBom(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

export function splitIdentifier(name: string): string[] {
  // Split on camelCase / PascalCase boundaries AND on snake_case / kebab-case
  // separators. Otherwise identifiers like `fetch_artur_sommer_data` stay as
  // one opaque token and the embedded first+last name never gets detected.
  return name
    .replace(/([a-z])([A-Z])/g, '$1\0$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')
    .split(/[\0_\-]+/)
    .filter(Boolean);
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.gradle',
  'target',
  'out',
  '.idea',
  '.vscode',
  'graphify-out',
  'graphify_out',
  'vendor',
  'venv',
  '.venv',
]);

export function pathMatchesAny(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return patterns.some((pattern) => {
    const p = pattern.replace(/\\/g, '/');
    if (!p.includes('*')) {
      return normalized === p || normalized.startsWith(p + '/');
    }
    const reStr = escapeRegex(p)
      .replace(/\\\*\\\*/g, '.*')
      .replace(/\\\*/g, '[^/]*');
    return new RegExp('^' + reStr + '$').test(normalized);
  });
}

export const STRUCTURAL_SUFFIXES = new Set([
  'service',
  'controller',
  'repository',
  'repo',
  'factory',
  'builder',
  'handler',
  'manager',
  'provider',
  'client',
  'server',
  'router',
  'middleware',
  'guard',
  'interceptor',
  'resolver',
  'module',
  'config',
  'utils',
  'helper',
  'error',
  'exception',
  'event',
  'listener',
  'gateway',
  'proxy',
  'wrapper',
  'decorator',
  'adapter',
  'store',
  'state',
  'action',
  'reducer',
  'component',
  'hook',
  'context',
  'dto',
  'entity',
  'model',
  'schema',
  'validator',
  'parser',
  'mapper',
  'queue',
  'worker',
  'job',
  'task',
  'scheduler',
  'cache',
  'logger',
  'strategy',
  'observer',
  'command',
  'query',
  'pipe',
  'directive',
  'layout',
  'page',
  'view',
]);
