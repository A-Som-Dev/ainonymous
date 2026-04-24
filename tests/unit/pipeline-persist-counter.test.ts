import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';

const ENV_SESSION_KEY = 'AINONYMOUS_SESSION_KEY';

describe('Pipeline seeds PseudoGen counters from the persist store', () => {
  let workdir: string;
  let originalKey: string | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ain-pipeline-counter-'));
    originalKey = process.env[ENV_SESSION_KEY];
    process.env[ENV_SESSION_KEY] = randomBytes(32).toString('base64');
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env[ENV_SESSION_KEY];
    else process.env[ENV_SESSION_KEY] = originalKey;
    rmSync(workdir, { recursive: true, force: true });
  });

  it('two pipelines against the same DB generate non-overlapping identifier pseudonyms', async () => {
    const config = {
      ...getDefaults(),
      session: { persist: true, persistPath: join(workdir, 'session.db') },
    };

    const p1 = new Pipeline(config);
    const alpha1 = p1.getPseudoGen().identifier('Foo');
    p1.close();

    const p2 = new Pipeline(config);
    const alpha2 = p2.getPseudoGen().identifier('Foo');
    p2.close();

    expect(alpha1).not.toBe(alpha2);
  });
});
