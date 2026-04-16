import type { Server } from 'node:http';

export async function listenWithFallback(
  server: Server,
  preferredPort: number,
  host: string,
  maxAttempts = 10,
): Promise<number> {
  let port = preferredPort;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await tryListen(server, port, host);
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') throw err;
      port++;
    }
  }

  throw new Error(
    `Could not bind to any port in range ${preferredPort}-${preferredPort + maxAttempts - 1}: ${(lastError as Error).message}`,
  );
}

function tryListen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve(actual);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    try {
      server.listen(port, host);
    } catch (err) {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
      reject(err);
    }
  });
}
