export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1\0$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')
    .split('\0')
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
