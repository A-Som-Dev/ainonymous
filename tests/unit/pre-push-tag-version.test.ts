import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('.githooks/pre-push tag-version gate', () => {
  const hook = readFileSync(join(process.cwd(), '.githooks', 'pre-push'), 'utf-8');

  it('checks refs/tags/v* against package.json version', () => {
    expect(hook).toMatch(/refs\/tags\/v\*/);
    expect(hook).toMatch(/package\.json/);
    expect(hook).toMatch(/does not match/);
  });

  it('aborts push on mismatch with non-zero exit', () => {
    expect(hook).toMatch(/exit 1/);
  });
});
