export const VERSION = '1.0.1';

export { Pipeline } from './pipeline/pipeline.js';
export { BiMap } from './session/map.js';
export { loadConfig, getDefaults } from './config/loader.js';
export { AuditLogger } from './audit/logger.js';
export { createProxyServer } from './proxy/server.js';
export { GlossaryManager } from './glossary/manager.js';
export { generateHookConfig } from './hooks/cc-hooks.js';

export type {
  AInonymityConfig,
  Layer,
  AnonymizeResult,
  Replacement,
  AuditEntry,
  SessionMap,
  PipelineContext,
} from './types.js';

export type { HookConfig } from './hooks/cc-hooks.js';
