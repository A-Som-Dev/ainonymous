import { describe, it, expect } from 'vitest';
import { StreamRehydrator } from '../../src/proxy/stream-rehydrator.js';

function anthropicDelta(index: number, text: string): string {
  return (
    'event: content_block_delta\n' +
    `data: ${JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })}\n\n`
  );
}

function anthropicBlockStart(index: number): string {
  return (
    'event: content_block_start\n' +
    `data: ${JSON.stringify({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })}\n\n`
  );
}

function anthropicBlockStop(index: number): string {
  return (
    'event: content_block_stop\n' +
    `data: ${JSON.stringify({ type: 'content_block_stop', index })}\n\n`
  );
}

function anthropicMessageStart(): string {
  return (
    'event: message_start\n' + `data: ${JSON.stringify({ type: 'message_start', message: {} })}\n\n`
  );
}

function anthropicMessageStop(): string {
  return 'event: message_stop\n' + `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
}

function openaiChunk(content: string | null, done = false): string {
  if (done) return 'data: [DONE]\n\n';
  const payload = {
    id: 'chatcmpl-x',
    choices: [{ index: 0, delta: content === null ? {} : { content } }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

// Collect all text that ends up in text_delta events emitted to the client
function extractAnthropicDeltas(out: string): string {
  const parts: string[] = [];
  const re = /^data:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj.type === 'content_block_delta') {
        const delta = obj.delta as Record<string, unknown> | undefined;
        const t = delta?.text;
        if (typeof t === 'string') parts.push(t);
      }
    } catch {
      // ignore malformed
    }
  }
  return parts.join('');
}

function extractOpenaiDeltas(out: string): string {
  const parts: string[] = [];
  const re = /^data:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const choices = obj.choices as Array<Record<string, unknown>> | undefined;
      if (choices) {
        for (const ch of choices) {
          const delta = ch.delta as Record<string, unknown> | undefined;
          const c = delta?.content;
          if (typeof c === 'string') parts.push(c);
        }
      }
    } catch {
      // ignore
    }
  }
  return parts.join('');
}

describe('StreamRehydrator (anthropic)', () => {
  it('passes through a single-delta block unchanged when no pseudonyms hit', () => {
    const rh = new StreamRehydrator('anthropic', (s) => s, 64);
    let out = '';
    out += rh.push(anthropicMessageStart());
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicDelta(0, 'Hello world'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.push(anthropicMessageStop());
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe('Hello world');
  });

  it('rehydrates a pseudonym that is emitted as one whole delta', () => {
    const rh = new StreamRehydrator('anthropic', (s) => s.replace(/AlphaCorp/g, 'AcmeCorp'), 64);
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicDelta(0, 'Use AlphaCorp service'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe('Use AcmeCorp service');
  });

  it('rehydrates a pseudonym split across two deltas', () => {
    const rh = new StreamRehydrator(
      'anthropic',
      (s) => s.replace(/AlphaCorpService/g, 'AcmeCorpService'),
      64,
    );
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicDelta(0, 'Alpha'));
    out += rh.push(anthropicDelta(0, 'CorpService is good'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe('AcmeCorpService is good');
  });

  it('rehydrates a pseudonym split across three deltas', () => {
    const rh = new StreamRehydrator(
      'anthropic',
      (s) => s.replace(/AlphaCorpService/g, 'AcmeCorpService'),
      64,
    );
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicDelta(0, 'Alpha'));
    out += rh.push(anthropicDelta(0, 'Corp'));
    out += rh.push(anthropicDelta(0, 'Service uses database'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe('AcmeCorpService uses database');
  });

  it('rehydrates a pseudonym that only arrives at the very end of the block', () => {
    const rh = new StreamRehydrator('anthropic', (s) => s.replace(/AlphaCorp/g, 'AcmeCorp'), 64);
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicDelta(0, 'The service is named Alpha'));
    out += rh.push(anthropicDelta(0, 'Corp'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe('The service is named AcmeCorp');
  });

  it('handles pseudonyms across multiple content blocks independently', () => {
    const rh = new StreamRehydrator(
      'anthropic',
      (s) => s.replace(/AlphaCorp/g, 'AcmeCorp').replace(/BetaInc/g, 'FooInc'),
      64,
    );
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicBlockStart(1));
    out += rh.push(anthropicDelta(0, 'Alpha'));
    out += rh.push(anthropicDelta(1, 'Beta'));
    out += rh.push(anthropicDelta(0, 'Corp here'));
    out += rh.push(anthropicDelta(1, 'Inc there'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.push(anthropicBlockStop(1));
    out += rh.flush();

    const combined = extractAnthropicDeltas(out);
    expect(combined).toContain('AcmeCorp here');
    expect(combined).toContain('FooInc there');
  });

  it('rehydrates several pseudonyms interleaved with plain text', () => {
    const rh = new StreamRehydrator(
      'anthropic',
      (s) => s.replace(/AlphaCorp/g, 'AcmeCorp').replace(/BetaInc/g, 'FooInc'),
      64,
    );
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicDelta(0, 'Works with Alpha'));
    out += rh.push(anthropicDelta(0, 'Corp and also Beta'));
    out += rh.push(anthropicDelta(0, 'Inc together.'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe('Works with AcmeCorp and also FooInc together.');
  });

  it('passes malformed SSE events through unchanged and keeps rehydrating later deltas', () => {
    const rh = new StreamRehydrator('anthropic', (s) => s.replace(/AlphaCorp/g, 'AcmeCorp'), 64);
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push('event: unknown\ndata: not json at all\n\n');
    out += rh.push(anthropicDelta(0, 'AlphaCorp done'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.flush();

    expect(out).toContain('not json at all');
    expect(extractAnthropicDeltas(out)).toBe('AcmeCorp done');
  });

  it('handles chunk boundaries falling in the middle of an SSE event', () => {
    const rh = new StreamRehydrator(
      'anthropic',
      (s) => s.replace(/AlphaCorpService/g, 'AcmeCorpService'),
      64,
    );
    const full =
      anthropicBlockStart(0) +
      anthropicDelta(0, 'Alpha') +
      anthropicDelta(0, 'CorpService rocks') +
      anthropicBlockStop(0);

    let out = '';
    for (let i = 0; i < full.length; i += 5) {
      out += rh.push(full.slice(i, i + 5));
    }
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe('AcmeCorpService rocks');
  });

  it('safe-suffix sized larger than longest pseudonym catches cross-delta splits', () => {
    // simulate a long pseudonym split mid-token
    const long = 'AlphaNumericIdentifierPseudonym';
    const original = 'AcmeNumericIdentifierPseudonym';
    const rh = new StreamRehydrator(
      'anthropic',
      (s) => s.replace(new RegExp(long, 'g'), original),
      long.length * 2 + 50,
    );
    let out = '';
    out += rh.push(anthropicBlockStart(0));
    out += rh.push(anthropicDelta(0, 'Alpha'));
    out += rh.push(anthropicDelta(0, 'Numeric'));
    out += rh.push(anthropicDelta(0, 'Identifier'));
    out += rh.push(anthropicDelta(0, 'Pseudonym at end'));
    out += rh.push(anthropicBlockStop(0));
    out += rh.flush();

    expect(extractAnthropicDeltas(out)).toBe(original + ' at end');
  });
});

describe('StreamRehydrator (openai)', () => {
  it('passes through plain text with no pseudonyms', () => {
    const rh = new StreamRehydrator('openai', (s) => s, 64);
    let out = '';
    out += rh.push(openaiChunk('Hello'));
    out += rh.push(openaiChunk(' world'));
    out += rh.push(openaiChunk(null, true));
    out += rh.flush();

    expect(extractOpenaiDeltas(out)).toBe('Hello world');
    expect(out).toContain('[DONE]');
  });

  it('rehydrates a pseudonym split across chunks', () => {
    const rh = new StreamRehydrator(
      'openai',
      (s) => s.replace(/AlphaCorpService/g, 'AcmeCorpService'),
      64,
    );
    let out = '';
    out += rh.push(openaiChunk('Alpha'));
    out += rh.push(openaiChunk('Corp'));
    out += rh.push(openaiChunk('Service works'));
    out += rh.push(openaiChunk(null, true));
    out += rh.flush();

    expect(extractOpenaiDeltas(out)).toBe('AcmeCorpService works');
  });

  it('flushes trailing buffer on [DONE]', () => {
    const rh = new StreamRehydrator('openai', (s) => s.replace(/AlphaCorp/g, 'AcmeCorp'), 64);
    let out = '';
    out += rh.push(openaiChunk('Use Alpha'));
    out += rh.push(openaiChunk('Corp'));
    out += rh.push(openaiChunk(null, true));
    out += rh.flush();

    expect(extractOpenaiDeltas(out)).toBe('Use AcmeCorp');
  });

  it('flushes trailing buffer on stream end even without [DONE]', () => {
    const rh = new StreamRehydrator('openai', (s) => s.replace(/AlphaCorp/g, 'AcmeCorp'), 64);
    let out = '';
    out += rh.push(openaiChunk('Alpha'));
    out += rh.push(openaiChunk('Corp done'));
    out += rh.flush();

    expect(extractOpenaiDeltas(out)).toBe('AcmeCorp done');
  });
});

describe('StreamRehydrator (performance)', () => {
  it('adds negligible overhead over naive passthrough', () => {
    const fn = (s: string) => s.replace(/AlphaCorp/g, 'AcmeCorp');
    const stream = (() => {
      let s = anthropicMessageStart() + anthropicBlockStart(0);
      for (let i = 0; i < 200; i++) {
        s += anthropicDelta(0, i % 5 === 0 ? 'Alpha' : 'Corp some text ');
      }
      s += anthropicBlockStop(0) + anthropicMessageStop();
      return s;
    })();

    const rh = new StreamRehydrator('anthropic', fn, 64);
    const start = process.hrtime.bigint();
    rh.push(stream);
    rh.flush();
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;

    expect(ms).toBeLessThan(50);
  });
});
