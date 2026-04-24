import { describe, it, expect } from 'vitest';
import { StreamRehydrator } from '../../src/proxy/stream-rehydrator.js';

function blockStart(index: number, contentBlock: Record<string, unknown>): string {
  return (
    'event: content_block_start\n' +
    `data: ${JSON.stringify({ type: 'content_block_start', index, content_block: contentBlock })}\n\n`
  );
}

function blockStop(index: number): string {
  return (
    'event: content_block_stop\n' +
    `data: ${JSON.stringify({ type: 'content_block_stop', index })}\n\n`
  );
}

function inputJsonDelta(index: number, partialJson: string): string {
  return (
    'event: content_block_delta\n' +
    `data: ${JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    })}\n\n`
  );
}

function thinkingDelta(index: number, thinking: string): string {
  return (
    'event: content_block_delta\n' +
    `data: ${JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking },
    })}\n\n`
  );
}

function extractFieldAcrossDeltas(out: string, field: 'partial_json' | 'thinking'): string {
  const parts: string[] = [];
  const re = /^data:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj.type !== 'content_block_delta') continue;
      const delta = obj.delta as Record<string, unknown> | undefined;
      const v = delta?.[field];
      if (typeof v === 'string') parts.push(v);
    } catch {
      /* ignore */
    }
  }
  return parts.join('');
}

describe('StreamRehydrator for anthropic tool_use input_json_delta', () => {
  it('passes input_json_delta through unchanged to avoid mangling tool-call JSON', () => {
    // Rehydrate would turn "Pseudo" into a string containing quotes; the
    // rehydrator must refuse to touch partial_json payloads so the JSON
    // stays parseable after the client reassembles it.
    const rehydrate = (t: string) => t.replace(/Pseudo/g, 'Real"quoted');
    const r = new StreamRehydrator('anthropic', rehydrate, 32);

    let out = '';
    out += r.push(blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} }));
    out += r.push(inputJsonDelta(0, '{"company":"Pseudo"}'));
    out += r.push(blockStop(0));
    out += r.flush();

    const combined = extractFieldAcrossDeltas(out, 'partial_json');
    expect(combined).toBe('{"company":"Pseudo"}');
  });

  it('preserves raw framing around the tool_use block', () => {
    const rehydrate = (t: string) => t.replace(/X/g, '');
    const r = new StreamRehydrator('anthropic', rehydrate, 16);
    let out = '';
    out += r.push(blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'noop', input: {} }));
    out += r.push(inputJsonDelta(0, '{}'));
    out += r.push(blockStop(0));
    out += r.flush();
    expect(out).toContain('content_block_start');
    expect(out).toContain('content_block_stop');
  });
});

describe('StreamRehydrator for anthropic thinking deltas', () => {
  it('rehydrates pseudonyms inside thinking blocks', () => {
    const rehydrate = (t: string) => t.replace(/PseudoAlpha/g, 'AcmeCorp');
    const r = new StreamRehydrator('anthropic', rehydrate, 64);

    let out = '';
    out += r.push(blockStart(1, { type: 'thinking', thinking: '' }));
    out += r.push(thinkingDelta(1, 'Rename Pseudo'));
    out += r.push(thinkingDelta(1, 'Alpha.'));
    out += r.push(blockStop(1));
    out += r.flush();

    const combined = extractFieldAcrossDeltas(out, 'thinking');
    expect(combined).toContain('AcmeCorp');
    expect(combined).not.toContain('PseudoAlpha');
    expect(combined).toContain('Rename');
  });
});
