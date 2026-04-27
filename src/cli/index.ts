#!/usr/bin/env node
import { Command } from 'commander';
import { VERSION } from '../index.js';
import { registerStartCmd } from './cmd-start.js';
import { registerInitCmd } from './cmd-init.js';
import { registerScanCmd } from './cmd-scan.js';
import { registerGlossaryCmd } from './cmd-glossary.js';
import { registerHooksCmd } from './cmd-hooks.js';
import { registerAuditCmd } from './cmd-audit.js';
import { registerDoctorCmd } from './cmd-doctor.js';
import { registerConfigCmd } from './cmd-config.js';
import { registerPreviewCmd } from './cmd-preview.js';
import { registerFiltersCmd } from './cmd-filters.js';
import { runWrapped } from './wrapper.js';

const program = new Command();
program
  .name('ainonymous')
  .description('Anonymize sensitive data before it reaches LLM APIs')
  .version(VERSION);

registerStartCmd(program);
registerInitCmd(program);
registerScanCmd(program);
registerGlossaryCmd(program);
registerHooksCmd(program);
registerAuditCmd(program);
registerDoctorCmd(program);
registerConfigCmd(program);
registerPreviewCmd(program);
registerFiltersCmd(program);

const dashIdx = process.argv.indexOf('--');
if (dashIdx !== -1 && dashIdx > 1) {
  const toolArgs = process.argv.slice(dashIdx + 1);
  runWrapped(toolArgs, process.cwd()).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  program.parse();
}
