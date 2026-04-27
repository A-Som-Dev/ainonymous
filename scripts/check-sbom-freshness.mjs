#!/usr/bin/env node
// Blocks `npm pack` / `npm publish` when sbom.cdx.json is older than
// package.json or package-lock.json. Catches the case where a local pack
// captured an SBOM generated before a dependency bump. Runs after
// `npm run sbom:regen` in the prepack pipeline, so under normal flow the
// SBOM is always current; this check exists for scenarios where prepack
// is bypassed or the script above fails silently.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

const sbom = mtime(resolve(root, 'sbom.cdx.json'));
if (sbom === null) {
  console.error('sbom.cdx.json missing - run `npm run sbom:regen` before pack.');
  process.exit(1);
}

const candidates = ['package.json', 'package-lock.json'];
let stale = false;
for (const rel of candidates) {
  const m = mtime(resolve(root, rel));
  if (m === null) continue;
  if (m > sbom + 5000) {
    console.error(
      `sbom.cdx.json is older than ${rel} (${new Date(sbom).toISOString()} vs ${new Date(m).toISOString()}).`,
    );
    stale = true;
  }
}

if (stale) {
  console.error('Refusing to ship a stale SBOM. Run `npm run sbom:regen`.');
  process.exit(2);
}
