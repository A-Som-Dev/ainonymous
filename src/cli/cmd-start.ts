import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { createProxyServer } from '../proxy/server.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { AuditLogger } from '../audit/logger.js';
import { listenWithFallback } from './listen-with-fallback.js';
import { getTokenPath, ensureTokenDir, hardenTokenFileAcl } from './token-path.js';
import { assertSafeBrowserUrl } from './safe-browser-url.js';
import { log } from '../logger.js';

async function openInBrowser(url: string): Promise<void> {
  assertSafeBrowserUrl(url);
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

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
      server.listen(port, process.env['AINONYMOUS_HOST'] ?? '127.0.0.1');
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
    .option('--open', 'open the dashboard in the default browser after start')
    .action(async (opts: { port?: string; dir: string; open?: boolean }) => {
      const config = loadConfig(opts.dir);
      const explicit = opts.port != null;
      const preferredPort = explicit ? parseInt(opts.port!, 10) : config.behavior.port;

      // Mint a mgmt token if the user didn't configure one. Without it any
      // local process can subscribe to the SSE stream and scrape pseudonym
      // pairs off loopback.
      const envMgmt = process.env['AINONYMOUS_MGMT_TOKEN']?.trim();
      const preConfigured = !!envMgmt || !!config.behavior.mgmtToken;
      if (!preConfigured) {
        config.behavior.mgmtToken = randomBytes(24).toString('hex');
      }
      const logger = new AuditLogger();
      const pipeline = new Pipeline(config, logger);
      try {
        await pipeline.loadConfiguredCustomFilters(opts.dir);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      const server = createProxyServer({ config, logger, pipeline });

      try {
        const actualPort = explicit
          ? await bindStrict(server, preferredPort)
          : await listenWithFallback(
              server,
              preferredPort,
              process.env['AINONYMOUS_HOST'] ?? '127.0.0.1',
            );

        // Silent port-fallback when the configured port is taken is an MITM
        // risk: an attacker who binds :8100 first sees the client traffic
        // while the proxy quietly runs on :8101 and the user believes the
        // proxy is up. Refuse to silently reroute when the port moved.
        if (!explicit && actualPort !== preferredPort) {
          console.error(
            `Port ${preferredPort} is in use; another process already owns it. ` +
              `Refusing to silently bind ${actualPort}. that would let the occupant of ${preferredPort} MITM your LLM traffic. ` +
              `Stop the occupant, or start with --port <n> to opt into a different port explicitly.`,
          );
          await new Promise<void>((r) => server.close(() => r()));
          process.exit(2);
        }

        const tokenFile = getTokenPath(actualPort);
        ensureTokenDir(tokenFile);
        writeFileSync(tokenFile, server.shutdownToken, { encoding: 'utf-8', mode: 0o600 });
        hardenTokenFileAcl(tokenFile);

        // Persist the mgmt token next to the shutdown token so the user can
        // read it for curl/dashboard access. Only written when we auto-gen'd
        // it. if the user set env or config, they already manage the token
        // themselves and we don't want to overwrite their file on disk.
        const mgmtTokenFile = tokenFile.replace(/\.token$/, '.mgmt.token');
        if (!preConfigured && config.behavior.mgmtToken) {
          writeFileSync(mgmtTokenFile, config.behavior.mgmtToken, {
            encoding: 'utf-8',
            mode: 0o600,
          });
          hardenTokenFileAcl(mgmtTokenFile);
        }

        const url = `http://127.0.0.1:${actualPort}`;
        const dashTokenParam = config.behavior.mgmtToken
          ? `?token=${encodeURIComponent(config.behavior.mgmtToken)}`
          : '';
        const dashboardUrl = `${url}/dashboard${dashTokenParam}`;
        console.log(`AInonymous proxy running on ${url}`);
        console.log(`Dashboard: ${dashboardUrl}`);
        console.log(
          `Set ANTHROPIC_BASE_URL=${url} or OPENAI_BASE_URL=${url} to route requests through the proxy`,
        );
        if (!preConfigured && config.behavior.mgmtToken) {
          console.log(`Auto-generated mgmt token saved to ${mgmtTokenFile}`);
        }

        if (opts.open && config.behavior.dashboard !== false) {
          openInBrowser(dashboardUrl).catch((err) => {
            log.warn('dashboard_open_failed', { err: String(err) });
          });
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
