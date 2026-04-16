import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { loadConfig } from '../config/loader.js';
import { createProxyServer } from '../proxy/server.js';
import { listenWithFallback } from './listen-with-fallback.js';

export async function runWrapped(toolArgs: string[], projectDir: string): Promise<void> {
  if (toolArgs.length === 0) {
    console.error('Usage: ainonymous -- <tool> [args...]');
    process.exit(1);
  }

  const config = loadConfig(projectDir);
  const server = createProxyServer({ config });

  const cleanup = (s: Server) => s.close();

  let port: number;
  try {
    port = await listenWithFallback(server, config.behavior.port, '127.0.0.1');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    console.error(`Server error: ${e.message}`);
    process.exit(1);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const [cmd, ...args] = toolArgs;

  // shell:true on Windows so that "claude" resolves to "claude.cmd"/"claude.ps1";
  // on POSIX shells resolve binaries directly and shell:true opens injection risk.
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: baseUrl,
      OPENAI_BASE_URL: baseUrl,
    },
    shell: process.platform === 'win32',
  });

  child.on('close', (code) => {
    cleanup(server);
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(`Failed to start ${cmd}: ${err.message}`);
    cleanup(server);
    process.exit(1);
  });

  process.on('SIGINT', () => cleanup(server));
  process.on('SIGTERM', () => cleanup(server));
}
