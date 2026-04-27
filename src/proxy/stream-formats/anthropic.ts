import type { AnthropicDeltaKind } from './types.js';

export function buildAnthropicDelta(index: number, text: string, kind: AnthropicDeltaKind): string {
  let delta: Record<string, unknown>;
  if (kind === 'input_json_delta') {
    delta = { type: 'input_json_delta', partial_json: text };
  } else if (kind === 'thinking_delta') {
    delta = { type: 'thinking_delta', thinking: text };
  } else {
    delta = { type: 'text_delta', text };
  }
  const body = { type: 'content_block_delta', index, delta };
  return `event: content_block_delta\ndata: ${JSON.stringify(body)}\n\n`;
}

export function anthropicDeltaKind(
  delta: Record<string, unknown>,
): { kind: AnthropicDeltaKind; text: string } | null {
  const t = delta['type'];
  if (t === 'text_delta') {
    return typeof delta['text'] === 'string' ? { kind: 'text_delta', text: delta['text'] } : null;
  }
  if (t === 'input_json_delta') {
    const pj = delta['partial_json'];
    return typeof pj === 'string' ? { kind: 'input_json_delta', text: pj } : null;
  }
  if (t === 'thinking_delta') {
    const th = delta['thinking'];
    return typeof th === 'string' ? { kind: 'thinking_delta', text: th } : null;
  }
  return null;
}
