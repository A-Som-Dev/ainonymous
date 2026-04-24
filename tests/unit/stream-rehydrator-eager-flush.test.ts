import { describe, it, expect } from 'vitest';
import { StreamRehydrator } from '../../src/proxy/stream-rehydrator.js';

function textDelta(index: number, text: string): string {
  return (
    'event: content_block_delta\n' +
    `data: ${JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text },
    })}\n\n`
  );
}

function emittedText(out: string): string {
  const parts: string[] = [];
  const re = /^data:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw) as { type?: string; delta?: { text?: string } };
      if (obj.type === 'content_block_delta' && typeof obj.delta?.text === 'string') {
        parts.push(obj.delta.text);
      }
    } catch {
      /* ignore */
    }
  }
  return parts.join('');
}

describe('StreamRehydrator eager_flush opt-in', () => {
  it('without eager flush the whole buffer is held until the block stops', () => {
    const r = new StreamRehydrator('anthropic', (s) => s, 64);
    let out = '';
    out += r.push(textDelta(0, 'Hello world.\n'));
    // Without eager flush, the sliding window keeps every char so nothing
    // visible downstream yet.
    expect(emittedText(out)).toBe('');
  });

  it('eager flush emits text up to the newline immediately', () => {
    const r = new StreamRehydrator('anthropic', (s) => s, 64, { eagerFlush: true });
    const out = r.push(textDelta(0, 'Hello world.\nNext line'));
    expect(emittedText(out)).toBe('Hello world.\n');
  });

  it('eager flush still respects sentence-end boundaries mid-text', () => {
    const r = new StreamRehydrator('anthropic', (s) => s, 64, { eagerFlush: true });
    const out = r.push(textDelta(0, 'One sentence. Another sentence. trailing'));
    const emitted = emittedText(out);
    expect(emitted).toContain('One sentence. ');
    expect(emitted).toContain('Another sentence. ');
    expect(emitted).not.toContain('trailing');
  });

  it('eager flush passes pseudonyms through the rehydrator before emit', () => {
    const rehydrate = (s: string) => s.replace(/Alpha/g, 'Acme');
    const r = new StreamRehydrator('anthropic', rehydrate, 64, { eagerFlush: true });
    const out = r.push(textDelta(0, 'Alpha service is ready.\n'));
    expect(emittedText(out)).toContain('Acme service');
  });
});
