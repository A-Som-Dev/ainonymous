import { describe, it, expect } from 'vitest';
import { generateHookConfig } from '../../src/hooks/cc-hooks.js';

describe('generateHookConfig', () => {
  it('produces valid hook structure', () => {
    const config = generateHookConfig(8100);
    expect(config.hooks).toBeDefined();
    expect(config.hooks.SessionStart).toHaveLength(1);
  });

  it('uses the given port in SessionStart command', () => {
    const config = generateHookConfig(9200);
    const cmd = config.hooks.SessionStart[0].command;
    expect(cmd).toContain('9200');
  });

  it('SessionStart falls back to start if status fails', () => {
    const config = generateHookConfig(8100);
    const cmd = config.hooks.SessionStart[0].command;
    expect(cmd).toContain('ainonymous status');
    expect(cmd).toContain('||');
    expect(cmd).toContain('ainonymous start');
  });

  it('all entries have type command', () => {
    const config = generateHookConfig(8100);
    for (const entry of config.hooks.SessionStart) {
      expect(entry.type).toBe('command');
    }
  });
});
