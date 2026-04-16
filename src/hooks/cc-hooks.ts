export interface HookEntry {
  type: 'command';
  command: string;
}

export interface HookConfig {
  hooks: {
    SessionStart: HookEntry[];
  };
}

export function generateHookConfig(port: number): HookConfig {
  return {
    hooks: {
      SessionStart: [
        { type: 'command', command: `ainonymous status -p ${port} || ainonymous start -p ${port}` },
      ],
    },
  };
}
