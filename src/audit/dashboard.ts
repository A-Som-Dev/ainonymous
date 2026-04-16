import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import type { AuditLogger } from './logger.js';
import type { LayerName } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const assetDir = resolve(here, '..', '..', 'dashboard');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const cache: Record<string, string> = {};

function readAsset(name: string): string {
  if (!cache[name]) {
    cache[name] = readFileSync(resolve(assetDir, name), 'utf-8');
  }
  return cache[name];
}

type SSEClient = ServerResponse;

const clients: SSEClient[] = [];

function removeClient(res: SSEClient): void {
  const idx = clients.indexOf(res);
  if (idx !== -1) clients.splice(idx, 1);
}

function sendEvent(res: SSEClient, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    removeClient(res);
  }
}

export function serveDashboard(res: ServerResponse): void {
  const html = readAsset('index.html');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    'content-security-policy': CSP,
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(html);
}

export function serveDashboardAsset(res: ServerResponse, file: 'app.js' | 'app.css'): void {
  const body = readAsset(file);
  const type = file.endsWith('.js')
    ? 'application/javascript; charset=utf-8'
    : 'text/css; charset=utf-8';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

export function serveSSE(res: ServerResponse, logger: AuditLogger): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  res.write('\n');

  clients.push(res);

  sendEvent(res, 'stats', logger.stats());

  res.on('close', () => removeClient(res));
}

export function broadcastEntry(entry: {
  timestamp: number;
  layer: LayerName;
  type: string;
  pseudonym: string;
}): void {
  for (let i = clients.length - 1; i >= 0; i--) {
    sendEvent(clients[i], 'entry', entry);
  }
}

export function broadcastStats(stats: {
  secrets: number;
  identity: number;
  code: number;
  total: number;
}): void {
  for (let i = clients.length - 1; i >= 0; i--) {
    sendEvent(clients[i], 'stats', stats);
  }
}
