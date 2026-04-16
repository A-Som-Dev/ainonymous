import type { Pipeline } from '../pipeline/pipeline.js';

// Headers that must reach the upstream LLM provider verbatim. Anonymizing the
// auth tokens would break authentication; anonymizing content-type or host
// would break routing. user-agent is deliberately NOT on this list: corporate
// wrappers, CI agents and IDE plugins routinely inject company names into the
// UA string, so it goes through the full pipeline like any other free-form
// text.
export const PASSTHROUGH_HEADERS = new Set<string>([
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'openai-organization',
  'openai-project',
  'openai-beta',
  'content-type',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'accept',
  'accept-encoding',
  'accept-language',
  'connection',
  'host',
  'cache-control',
  'pragma',
]);

type HeaderBag = Record<string, string | string[] | undefined>;

function isPassthrough(name: string): boolean {
  return PASSTHROUGH_HEADERS.has(name.toLowerCase());
}

export async function anonymizeHeaders(headers: HeaderBag, pipeline: Pipeline): Promise<HeaderBag> {
  const result: HeaderBag = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || isPassthrough(key)) {
      result[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const anon: string[] = [];
      for (const v of value) {
        if (v.length === 0) {
          anon.push(v);
          continue;
        }
        const r = await pipeline.anonymize(v);
        anon.push(r.text);
      }
      result[key] = anon;
      continue;
    }

    if (value.length === 0) {
      result[key] = value;
      continue;
    }

    const r = await pipeline.anonymize(value);
    result[key] = r.text;
  }

  return result;
}
