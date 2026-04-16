import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { forwardWithRehydration } from '../../src/proxy/forwarder.js';

function fakeResponse(): http.ServerResponse & {
  written: string;
  statusCode_: number;
  headers_: Record<string, string>;
} {
  const chunks: string[] = [];
  const res = {
    written: '',
    statusCode_: 0,
    headers_: {} as Record<string, string>,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode_ = status;
      res.headers_ = headers ?? {};
      res.headersSent = true;
    },
    write(data: string) {
      chunks.push(data);
      res.written = chunks.join('');
      return true;
    },
    end(data?: string) {
      if (data) chunks.push(data);
      res.written = chunks.join('');
    },
  };
  return res as any;
}

describe('forwardWithRehydration', () => {
  let upstream: http.Server | null = null;

  afterEach(async () => {
    if (upstream) {
      await new Promise<void>((r) => upstream!.close(() => r()));
      upstream = null;
    }
  });

  it('forwards request and rehydrates non-SSE response', async () => {
    upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"text":"PSEUDO_A"}');
    });

    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as any).port;

    const clientRes = fakeResponse();
    const done = new Promise<void>((resolve) => {
      const origEnd = clientRes.end.bind(clientRes);
      clientRes.end = ((data?: string) => {
        origEnd(data);
        resolve();
      }) as any;
    });

    forwardWithRehydration(
      {
        upstream: `http://127.0.0.1:${port}`,
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: '{}',
      },
      clientRes as any,
      (chunk) => chunk.replace('PSEUDO_A', 'ORIGINAL_A'),
    );

    await done;
    expect(clientRes.written).toContain('ORIGINAL_A');
  });

  it('rehydrates SSE events at event boundaries', async () => {
    upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: PSEUDO_X\n\n');
      res.write('data: PSEUDO_Y\n\n');
      res.end();
    });

    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as any).port;

    const clientRes = fakeResponse();
    const done = new Promise<void>((resolve) => {
      const origEnd = clientRes.end.bind(clientRes);
      clientRes.end = ((data?: string) => {
        origEnd(data);
        resolve();
      }) as any;
    });

    forwardWithRehydration(
      {
        upstream: `http://127.0.0.1:${port}`,
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: '{}',
      },
      clientRes as any,
      (chunk) => chunk.replace(/PSEUDO_X/g, 'REAL_X').replace(/PSEUDO_Y/g, 'REAL_Y'),
    );

    await done;
    expect(clientRes.written).toContain('REAL_X');
    expect(clientRes.written).toContain('REAL_Y');
  });

  it('returns 502 when upstream is unreachable', async () => {
    const clientRes = fakeResponse();
    const done = new Promise<void>((resolve) => {
      const origEnd = clientRes.end.bind(clientRes);
      clientRes.end = ((data?: string) => {
        origEnd(data);
        resolve();
      }) as any;
    });

    forwardWithRehydration(
      {
        upstream: 'http://127.0.0.1:1',
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: '{}',
      },
      clientRes as any,
      (c) => c,
    );

    await done;
    expect(clientRes.statusCode_).toBe(502);
    expect(clientRes.written).toContain('upstream_error');
  });

  it('reassembles split pseudonyms across SSE deltas when streamFormat is set', async () => {
    upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const deltas = [
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Alpha"}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Corp"}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Service rocks"}}\n\n`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
      ];
      for (const d of deltas) res.write(d);
      res.end();
    });

    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as any).port;

    const clientRes = fakeResponse();
    const done = new Promise<void>((resolve) => {
      const origEnd = clientRes.end.bind(clientRes);
      clientRes.end = ((data?: string) => {
        origEnd(data);
        resolve();
      }) as any;
    });

    forwardWithRehydration(
      {
        upstream: `http://127.0.0.1:${port}`,
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: '{}',
        streamFormat: 'anthropic',
        maxPseudoLen: 16,
      },
      clientRes as any,
      (chunk) => chunk.replace(/AlphaCorpService/g, 'AcmeCorpService'),
    );

    await done;

    // pull every text_delta payload out of the emitted stream and concatenate
    const parts: string[] = [];
    const re = /^data:\s*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clientRes.written)) !== null) {
      try {
        const obj = JSON.parse(m[1]);
        if (obj.type === 'content_block_delta' && obj.delta?.text) {
          parts.push(obj.delta.text);
        }
      } catch {
        // ignore
      }
    }
    expect(parts.join('')).toBe('AcmeCorpService rocks');
  });

  it('times out slow upstream requests', async () => {
    upstream = http.createServer((_req, _res) => {
      // never respond — let the timeout fire
    });

    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as any).port;

    const clientRes = fakeResponse();
    const done = new Promise<void>((resolve) => {
      const origEnd = clientRes.end.bind(clientRes);
      clientRes.end = ((data?: string) => {
        origEnd(data);
        resolve();
      }) as any;
    });

    forwardWithRehydration(
      {
        upstream: `http://127.0.0.1:${port}`,
        method: 'POST',
        path: '/v1/messages',
        headers: {},
        body: '{}',
      },
      clientRes as any,
      (c) => c,
    );

    await done;
    expect(clientRes.statusCode_).toBe(502);
    expect(clientRes.written).toContain('upstream_error');
  }, 35_000);
});
