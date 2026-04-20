import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('.github/workflows/release.yml order', () => {
  const wf = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf-8');

  it('checks tag vs package.json before anything else publish-related', () => {
    expect(wf).toMatch(/Verify tag matches package\.json/);
    const tagCheckPos = wf.indexOf('Verify tag matches package.json');
    const packPos = wf.indexOf('Pack npm tarball');
    expect(tagCheckPos).toBeGreaterThan(-1);
    expect(packPos).toBeGreaterThan(tagCheckPos);
  });

  it('runs npm publish --dry-run before the real publish', () => {
    const dryPos = wf.indexOf('npm publish --dry-run');
    const publishPos = wf.indexOf('npm publish --provenance --access public');
    expect(dryPos).toBeGreaterThan(-1);
    expect(publishPos).toBeGreaterThan(dryPos);
  });

  it('signs tarball AFTER npm publish succeeds to avoid orphan provenance', () => {
    const publishPos = wf.indexOf('Publish to npm with provenance');
    const signTarballPos = wf.indexOf('Sign tarball with cosign');
    expect(publishPos).toBeGreaterThan(-1);
    expect(signTarballPos).toBeGreaterThan(publishPos);
  });

  it('signs SBOM after npm publish as well', () => {
    const publishPos = wf.indexOf('Publish to npm with provenance');
    const signSbomPos = wf.indexOf('Sign SBOM with cosign');
    expect(signSbomPos).toBeGreaterThan(publishPos);
  });
});
