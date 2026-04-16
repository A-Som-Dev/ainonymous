import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { createProxyServer } from '../proxy/server.js';
import { listenWithFallback } from './listen-with-fallback.js';
import { getTokenPath, ensureTokenDir, hardenTokenFileAcl } from './token-path.js';
import { log } from '../logger.js';

function bindStrict(server: ReturnType<typeof createProxyServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    try {
      server.listen(port, process.env['AINONYMITY_HOST'] ?? '127.0.0.1');
    } catch (err) {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
      reject(err);
    }
  });
}

export function registerStartCmd(program: Command): void {
  program
    .command('start')
    .description('Start the anonymizing proxy server')
    .option('-p, --port <number>', 'port to listen on')
    .option('-d, --dir <path>', 'project directory', process.cwd())
    .action(async (opts: { port?: string; dir: string }) => {
      const config = loadConfig(opts.dir);
      const explicit = opts.port != null;
      const preferredPort = explicit ? parseInt(opts.port!, 10) : config.behavior.port;
      const server = createProxyServer({ config });

      try {
        const actualPort = explicit
          ? await bindStrict(server, preferredPort)
          : await listenWithFallback(
              server,
              preferredPort,
              process.env['AINONYMITY_HOST'] ?? '127.0.0.1',
            );

        const tokenFile = getTokenPath(actualPort);
        ensureTokenDir(tokenFile);
        writeFileSync(tokenFile, server.shutdownToken, { encoding: 'utf-8', mode: 0o600 });
        hardenTokenFileAcl(tokenFile);
        const url = `http://127.0.0.1:${actualPort}`;
        console.log(`AInonymity proxy running on ${url}`);
        console.log(
          `Set ANTHROPIC_BASE_URL=${url} or OPENAI_BASE_URL=${url} to route requests through the proxy`,
        );

        const host = process.env['AINONYMITY_HOST'] ?? '127.0.0.1';
        const envToken = process.env['AINONYMITY_MGMT_TOKEN']?.trim();
        const hasToken = (envToken && envToken.length > 0) || !!config.behavior.mgmtToken;
        if (host === '0.0.0.0' && !hasToken) {
          console.warn(
            `Warning: Management endpoints (/metrics, /dashboard, /events) are exposed on ${host} without authentication. Set AINONYMITY_MGMT_TOKEN or behavior.mgmt_token in config.`,
          );
          log.warn('management_endpoints_unauthenticated', { host, reason: 'no_token_set' });
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EADDRINUSE') {
          console.error(`Port ${preferredPort} is already in use. Pick another with -p.`);
        } else {
          console.error(`Server error: ${e.message}`);
        }
        process.exit(1);
      }
    });

  program
    .command('stop')
    .description('Stop the running proxy')
    .option('-p, --port <number>', 'port to check', '8100')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const tokenFile = getTokenPath(port);
      try {
        const token = readFileSync(tokenFile, 'utf-8').trim();
        await fetch(`http://127.0.0.1:${port}/shutdown?token=${token}`);
        try {
          unlinkSync(tokenFile);
        } catch {}
        console.log('Proxy stopped');
      } catch {
        console.log(`No proxy running on port ${port}`);
      }
    });

  program
    .command('status')
    .description('Check if the proxy is running')
    .option('-p, --port <number>', 'port to check', '8100')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const url = `http://127.0.0.1:${port}/health`;

      try {
        const res = await fetch(url);
        const data = (await res.json()) as Record<string, unknown>;

        if (data.status === 'ok') {
          const uptimeMs = data.uptime as number;
          const uptimeSec = Math.floor(uptimeMs / 1000);
          console.log(`Proxy is running on port ${port}`);
          console.log(
            `  Uptime: ${uptimeSec}s | Requests: ${data.requests} | Session map: ${data.sessionMapSize} entries`,
          );
        } else {
          console.log('Proxy responded but status is not ok');
        }
      } catch {
        console.log(`No proxy running on port ${port}`);
        process.exit(1);
      }
    });
}
