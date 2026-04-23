import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = mkdtempSync(join(tmpdir(), 'ain-test-state-home-'));
process.env['AINONYMOUS_STATE_HOME'] = sandbox;
