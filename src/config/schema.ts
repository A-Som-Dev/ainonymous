import type { AInonymousConfig } from '../types.js';

export const DEFAULT_CONFIG: AInonymousConfig = {
  version: 1,
  secrets: { patterns: [] },
  identity: { company: '', domains: [], people: [] },
  code: {
    language: 'typescript',
    domainTerms: [],
    preserve: [],
    sensitivePaths: [],
    redactBodies: [],
  },
  behavior: {
    interactive: true,
    auditLog: true,
    auditDir: './ainonymous-audit',
    dashboard: true,
    port: 8100,
    compliance: undefined,
    upstream: {
      anthropic: 'https://api.anthropic.com',
      openai: 'https://api.openai.com',
    },
    mgmtToken: undefined,
  },
  session: {
    persist: false,
    persistPath: undefined,
  },
};
