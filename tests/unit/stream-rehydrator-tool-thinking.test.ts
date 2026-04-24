import { describe, it, expect } from 'vitest';
import { StreamRehydrator } from '../../src/proxy/stream-rehydrator.js';

// Synthetic SSE fixtures for the Anthropic content-block delta variants
// the v1.3.0 cleanup did not have native coverage for. Live verification
// against the real Claude tool-use loop is on the post-merge checklist.

function delta(index: number, type: string, fields: Record<string, unknown>): string {
  const payload = {
    type: 'content_block_delta',
    index,
    delta: { type, ...fields },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(payload)}\n\n`;
}

function blockStart(index: number, content_block: Record<string, unknown>): string {
  const payload = { type: 'content_block_start', index, content_block };
  return `event: content_block_start\ndata: ${JSON.stringify(payload)}\n\n`;
}

function blockStop(index: number): string {
  return `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index })}\n\n`;
}

function extractDeltas(out: string, type: string): string[] {
  const parts: string[] = [];
  for (const line of out.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const body = line.slice(6).trim();
    if (!body || body === '[DONE]') continue;
    try {
      const obj = JSON.parse(body) as Record<string, unknown>;
      if (obj.type !== 'content_block_delta') continue;
      const d = obj.delta as Record<string, unknown> | undefined;
      if (d?.type !== type) continue;
      const text = d.text ?? d.thinking ?? d.partial_json;
      if (typeof text === 'string') parts.push(text);
    } catch {
      /* ignore */
    }
  }
  return parts;
}

const replace = (text: string): string =>
  text.split('PSEUDO_X').join('Customer-42').split('PSEUDO_Y').join('order-887');

describe('StreamRehydrator handles thinking_delta', () => {
  it('rehydrates pseudonyms inside thinking_delta blocks', () => {
    const r = new StreamRehydrator('anthropic', replace, 32);
    let out = '';
    out += r.push(blockStart(0, { type: 'thinking', thinking: '' }));
    out += r.push(delta(0, 'thinking_delta', { thinking: 'Rerouting PSEUDO_X via PSEUDO_Y now.' }));
    out += r.push(blockStop(0));
    out += r.flush();

    const thinkings = extractDeltas(out, 'thinking_delta');
    const joined = thinkings.join('');
    expect(joined).toContain('Customer-42');
    expect(joined).toContain('order-887');
    expect(joined).not.toContain('PSEUDO_X');
    expect(joined).not.toContain('PSEUDO_Y');
  });
});

describe('StreamRehydrator handles input_json_delta', () => {
  it('forwards input_json_delta payloads unchanged (rehydrate would break JSON syntax)', () => {
    const r = new StreamRehydrator('anthropic', replace, 32);
    let out = '';
    out += r.push(blockStart(0, { type: 'tool_use', id: 't1', name: 'do_thing', input: {} }));
    // Pseudonym in JSON body - the rehydrator must not rewrite this fragment
    // because partial JSON text could contain unbalanced quotes once the
    // replacement lands. The plaintext stays "PSEUDO_X" until the client
    // reconstructs the full JSON and runs its own rehydrate pass.
    const json = '{"id":"PSEUDO_X","amount":42}';
    out += r.push(delta(0, 'input_json_delta', { partial_json: json }));
    out += r.push(blockStop(0));
    out += r.flush();

    const passthrough = extractDeltas(out, 'input_json_delta');
    expect(passthrough.join('')).toBe(json);
    // Confirm the pseudonym did NOT get replaced inline.
    expect(out).toContain('PSEUDO_X');
    expect(out).not.toContain('Customer-42');
  });
});

describe('StreamRehydrator handles mixed text + tool_use blocks', () => {
  it('rehydrates the text block and forwards the tool_use json block independently', () => {
    const r = new StreamRehydrator('anthropic', replace, 16);
    let out = '';

    // Block 0: assistant text
    out += r.push(blockStart(0, { type: 'text', text: '' }));
    out += r.push(delta(0, 'text_delta', { text: 'Calling tool for PSEUDO_X.' }));
    out += r.push(blockStop(0));

    // Block 1: tool_use with json args
    out += r.push(blockStart(1, { type: 'tool_use', id: 't1', name: 'fetch', input: {} }));
    out += r.push(delta(1, 'input_json_delta', { partial_json: '{"order":"PSEUDO_Y"}' }));
    out += r.push(blockStop(1));

    out += r.flush();

    const texts = extractDeltas(out, 'text_delta');
    expect(texts.join('')).toContain('Customer-42');
    expect(texts.join('')).not.toContain('PSEUDO_X');

    const tools = extractDeltas(out, 'input_json_delta');
    expect(tools.join('')).toContain('PSEUDO_Y');
    expect(tools.join('')).not.toContain('order-887');
  });
});

describe('StreamRehydrator forwards content_block_start for tool_use blocks unchanged', () => {
  it('does not corrupt the tool_use block_start envelope', () => {
    const r = new StreamRehydrator('anthropic', replace, 32);
    const startEvent = blockStart(0, { type: 'tool_use', id: 't9', name: 'lookup', input: {} });
    const out = r.push(startEvent) + r.flush();
    expect(out).toContain('"type":"tool_use"');
    expect(out).toContain('"id":"t9"');
    expect(out).toContain('"name":"lookup"');
  });
});
