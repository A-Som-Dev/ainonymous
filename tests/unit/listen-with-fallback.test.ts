import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { listenWithFallback } from '../../src/cli/listen-with-fallback.js';

describe('listenWithFallback', () => {
  const cleanup: Server[] = [];

  afterEach(async () => {
    for (const s of cleanup) {
      await new Promise<void>((r) => s.close(() => r()));
    }
    cleanup.length = 0;
  });

  it('binds to preferred port when free', async () => {
    const server = createServer();
    cleanup.push(server);

    const port = await listenWithFallback(server, 0, '127.0.0.1');
    expect(port).toBeGreaterThan(0);

    const addr = server.address();
    const actual = typeof addr === 'object' && addr ? addr.port : -1;
    expect(actual).toBe(port);
  });

  it('falls back to next port when preferred is busy', async () => {
    const blocker = createServer();
    cleanup.push(blocker);
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const busyPort = (blocker.address() as { port: number }).port;

    const server = createServer();
    cleanup.push(server);
    const actualPort = await listenWithFallback(server, busyPort, '127.0.0.1');

    expect(actualPort).not.toBe(busyPort);
    expect(actualPort).toBeGreaterThan(busyPort);
    expect(actualPort).toBeLessThanOrEqual(busyPort + 10);
  });

  it('rejects after exhausting all fallback attempts', async () => {
    const blockers: Server[] = [];
    const startPort = 40000 + Math.floor(Math.random() * 10000);

    for (let i = 0; i < 3; i++) {
      const b = createServer();
      cleanup.push(b);
      blockers.push(b);
      await new Promise<void>((r) => b.listen(startPort + i, '127.0.0.1', r));
    }

    const server = createServer();
    cleanup.push(server);

    await expect(listenWithFallback(server, startPort, '127.0.0.1', 3)).rejects.toThrow();
  });

  it('surfaces non-EADDRINUSE errors without retrying', async () => {
    const server = createServer();
    cleanup.push(server);

    await expect(listenWithFallback(server, -1, '127.0.0.1')).rejects.toThrow();
  });
});
