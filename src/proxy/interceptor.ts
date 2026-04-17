import type { IncomingMessage } from 'node:http';
import type { ApiFormat } from '../types.js';

export interface ParsedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

// Inference-control fields whose string content is constant (model ID, enum
// mode, seed material). Leaving these alone keeps the LLM routing untouched.
// Fields that may legitimately carry user text (stop_sequences, tools,
// response_format.schema) are NOT in this set. they flow through the pipeline
// so PII embedded in tool descriptions, stop markers and JSON schemas gets
// pseudonymised consistently with the rest of the payload.
const SCALAR_FIELDS = new Set([
  // shared
  'model',
  'max_tokens',
  'stream',
  'temperature',
  'top_p',
  // anthropic-specific
  'top_k',
  // openai-specific
  'n',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'seed',
  'tool_choice',
]);

const MAX_BODY = 10 * 1024 * 1024; // 10 MB

export function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function parseRequest(req: IncomingMessage, rawBody: string): ParsedRequest {
  let body: unknown = rawBody;
  const contentType = req.headers['content-type'] ?? '';

  if (contentType.includes('application/json') && rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      // keep raw string if parsing fails
    }
  }

  return {
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    headers: req.headers as Record<string, string | string[] | undefined>,
    body,
  };
}

export function detectApiFormat(json: unknown, path: string): ApiFormat {
  if (path.includes('/v1/messages')) return 'anthropic';
  if (path.includes('/v1/chat/completions')) return 'openai';

  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if ('system' in obj && typeof obj.system === 'string') return 'anthropic';
    if ('messages' in obj && Array.isArray(obj.messages)) {
      const msgs = obj.messages as Array<Record<string, unknown>>;
      if (msgs.some((m) => m.role === 'system')) return 'openai';
    }
  }

  return 'unknown';
}

export async function replaceTextInJson(
  json: unknown,
  replaceFn: (text: string) => Promise<string>,
): Promise<unknown> {
  return deepReplace(json, replaceFn);
}

async function deepReplace(
  node: unknown,
  replaceFn: (text: string) => Promise<string>,
  parentKey?: string,
): Promise<unknown> {
  if (typeof node === 'string') {
    if (parentKey && SCALAR_FIELDS.has(parentKey)) {
      return node;
    }
    return replaceFn(node);
  }

  if (Array.isArray(node)) {
    const mapped: unknown[] = [];
    for (const item of node) {
      const inheritKey = typeof item === 'string' ? parentKey : undefined;
      mapped.push(await deepReplace(item, replaceFn, inheritKey));
    }
    return mapped;
  }

  if (node !== null && typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      result[key] = await deepReplace(val, replaceFn, key);
    }
    return result;
  }

  return node;
}
