import { resolve, isAbsolute } from 'node:path';
import type { OrPostFilter } from './types.js';
import { loadPinnedModuleSource } from '../../util/pinned-module.js';

export interface CustomFilterSpec {
  /** Path (absolute or relative to projectDir) to a `.mjs`/`.js` file that
   *  default-exports an OrPostFilter or an array of them. */
  path: string;
  /** Caller has acknowledged that this is unsigned local code. */
  allowUnsignedLocal: boolean;
  /** Optional lowercase-hex SHA-256 digest. When present, loader hashes the
   *  file before import and refuses to load on mismatch. A pin narrows the
   *  trust-gate from "any local file" to "this specific bytes". */
  sha256?: string;
}

export interface LoadedFilter {
  filter: OrPostFilter;
  path: string;
}

export class UnsignedFilterError extends Error {
  constructor(path: string) {
    super(
      `refusing to load unsigned local filter "${path}". ` +
        `Set trust.allow_unsigned_local: true in .ainonymous.yml to opt in.`,
    );
    this.name = 'UnsignedFilterError';
  }
}

export class FilterPinMismatchError extends Error {
  constructor(path: string, expected: string, actual: string) {
    super(
      `custom filter "${path}" sha256 pin mismatch. ` +
        `Expected ${expected}, got ${actual}.`,
    );
    this.name = 'FilterPinMismatchError';
  }
}

export async function loadCustomFilters(
  specs: CustomFilterSpec[],
  projectDir: string,
): Promise<LoadedFilter[]> {
  // Fail-fast: one bad spec (missing file, unsigned load when gate is off,
  // pin mismatch, malformed pin) rejects the whole batch rather than
  // partial-load. A half-loaded chain is harder to reason about than a
  // hard failure the operator has to clear before traffic flows.
  const resolved = specs.map((spec) => {
    const abs = isAbsolute(spec.path) ? spec.path : resolve(projectDir, spec.path);
    if (!spec.allowUnsignedLocal) {
      throw new UnsignedFilterError(abs);
    }
    const { dataUrl } = loadPinnedModuleSource(abs, spec.sha256, (path, expected, actual) => {
      throw new FilterPinMismatchError(path, expected, actual);
    });
    return { abs, dataUrl };
  });

  const modules = await Promise.all(
    resolved.map(
      (r) =>
        import(r.dataUrl) as Promise<{
          default?: OrPostFilter | OrPostFilter[];
        }>,
    ),
  );

  const out: LoadedFilter[] = [];
  for (let i = 0; i < modules.length; i++) {
    const abs = resolved[i].abs;
    const mod = modules[i];
    const exported = mod.default;
    if (!exported) {
      throw new Error(`custom filter ${abs} has no default export`);
    }
    const filters = Array.isArray(exported) ? exported : [exported];
    for (const f of filters) assertFilterShape(f, abs);
    for (const f of filters) out.push({ filter: f, path: abs });
  }
  return out;
}

function assertFilterShape(f: OrPostFilter, path: string): void {
  if (!f || typeof f !== 'object') {
    throw new Error(`custom filter ${path} default export must be an OrPostFilter object`);
  }
  if (typeof f.id !== 'string' || f.id.length === 0) {
    throw new Error(`custom filter ${path} missing string id`);
  }
  if (typeof f.accept !== 'function') {
    throw new Error(`custom filter ${path} missing accept() function`);
  }
}
