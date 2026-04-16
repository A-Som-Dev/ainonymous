import { log } from '../logger.js';

export type StreamFormat = 'anthropic' | 'openai';

type RehydrateFn = (text: string) => string;

interface BlockBuf {
  pending: string;
}

/** Bridges chunked SSE streams and the text-based rehydrator. Pseudonyms may
 *  arrive split across multiple `text_delta` events (e.g. "Alpha" | "Corp" |
 *  "Service"). Running rehydrate on each fragment finds nothing. The solution
 *  here: per content-block, keep a sliding suffix buffer large enough to hold
 *  any pseudonym in the session map, then rehydrate only the prefix that can
 *  no longer be a split token. On block/stream end the tail is flushed.
 */
export class StreamRehydrator {
  private readonly format: StreamFormat;
  private readonly rehydrate: RehydrateFn;
  private readonly safeSuffix: number;
  private leftover = '';
  private readonly blocks = new Map<number, BlockBuf>();
  // OpenAI has only a single logical stream - we treat it as block index 0.
  private readonly openaiBlockIndex = 0;
  /** Remember the upstream chat-completion id so the synthetic flush chunk
   *  looks like a real one from the same completion. */
  private openaiCompletionId: string | null = null;
  private openaiModel: string | null = null;

  constructor(format: StreamFormat, rehydrate: RehydrateFn, safeSuffix: number) {
    this.format = format;
    this.rehydrate = rehydrate;
    this.safeSuffix = Math.max(16, safeSuffix);
  }

  /** Accept more bytes from the upstream; returns whatever is safe to emit to
   *  the client now. May buffer up to `safeSuffix` chars per content block
   *  before emitting. */
  push(chunk: string): string {
    this.leftover += chunk;
    let out = '';

    let idx: number;
    while ((idx = this.leftover.indexOf('\n\n')) !== -1) {
      const raw = this.leftover.slice(0, idx + 2);
      this.leftover = this.leftover.slice(idx + 2);
      out += this.handleEvent(raw);
    }

    return out;
  }

  /** Drains all remaining buffered text (per-block pending + stream leftover).
   *  Must be called once upstream signals end-of-stream. */
  flush(): string {
    let out = '';
    // Any unterminated leftover from a truncated stream: try to process if it
    // looks like a complete event, otherwise pass through raw so nothing is
    // lost (caller will see an incomplete SSE tail, same as upstream sent).
    if (this.leftover.length > 0) {
      if (this.leftover.includes('data:')) {
        out += this.handleEvent(this.leftover);
      } else {
        out += this.leftover;
      }
      this.leftover = '';
    }
    for (const index of [...this.blocks.keys()]) {
      out += this.drainBlock(index, /* emitAsDelta */ true);
    }
    return out;
  }

  // --- internals -----------------------------------------------------------

  private handleEvent(raw: string): string {
    const dataPayload = extractDataPayload(raw);
    if (dataPayload === null) {
      // no data: line (e.g. comment, heartbeat, blank-only block) - passthrough
      return raw;
    }

    if (dataPayload.trim() === '[DONE]') {
      let out = '';
      for (const index of [...this.blocks.keys()]) {
        out += this.drainBlock(index, true);
      }
      return out + raw;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(dataPayload);
    } catch {
      if (process.env['DEBUG']) log.warn('sse parse failed', { len: dataPayload.length });
      return raw;
    }

    if (this.format === 'anthropic') {
      return this.handleAnthropicEvent(raw, payload);
    }
    return this.handleOpenaiEvent(raw, payload);
  }

  private handleAnthropicEvent(raw: string, payload: unknown): string {
    if (!isObj(payload)) return raw;
    const type = payload['type'];

    if (type === 'content_block_delta') {
      const index = numIndex(payload['index']);
      const delta = payload['delta'];
      if (!isObj(delta) || delta['type'] !== 'text_delta') return raw;
      const text = delta['text'];
      if (typeof text !== 'string') return raw;

      const emit = this.appendToBlock(index, text);
      if (!emit) return ''; // fully buffered, no delta to forward yet
      return buildAnthropicDelta(index, emit);
    }

    if (type === 'content_block_stop') {
      const index = numIndex(payload['index']);
      const tail = this.drainBlockText(index);
      if (tail.length === 0) return raw;
      // Emit the flushed tail as its own extra delta immediately before the
      // stop event so the client sees the complete rehydrated text. The
      // original stop event is forwarded unchanged after.
      return buildAnthropicDelta(index, tail) + raw;
    }

    return raw;
  }

  private handleOpenaiEvent(raw: string, payload: unknown): string {
    if (!isObj(payload)) return raw;
    if (typeof payload['id'] === 'string') this.openaiCompletionId = payload['id'];
    if (typeof payload['model'] === 'string') this.openaiModel = payload['model'];
    const choices = payload['choices'];
    if (!Array.isArray(choices) || choices.length === 0) return raw;

    let anyText = false;
    let allEmptyAfterBuffer = true;
    let carriesMetadata = false;

    const newChoices = choices.map((ch) => {
      if (!isObj(ch)) return ch;
      if (ch['finish_reason'] != null) carriesMetadata = true;
      const delta = ch['delta'];
      if (!isObj(delta)) return ch;
      const content = delta['content'];
      if (typeof content !== 'string') {
        // delta has other fields (role, tool_calls, etc.) - keep chunk
        carriesMetadata = true;
        return ch;
      }

      anyText = true;
      const emit = this.appendToBlock(this.openaiBlockIndex, content);
      if (emit.length > 0) allEmptyAfterBuffer = false;
      return { ...ch, delta: { ...delta, content: emit } };
    });

    let primary: string;
    if (!anyText) {
      primary = raw;
    } else if (allEmptyAfterBuffer && !carriesMetadata) {
      primary = '';
    } else {
      const out = { ...payload, choices: newChoices };
      primary = buildOpenaiChunk(out);
    }

    // A chunk carrying finish_reason signals end-of-turn. The primary chunk
    // above already emitted whatever was safe to flush from the start of the
    // buffer; now empty the trailing suffix (which is semantically *after*
    // the primary chunk's content) and emit it BEFORE the finish marker.
    if (carriesMetadata) {
      const flushed = this.drainBlock(this.openaiBlockIndex, true);
      return flushed + primary;
    }
    return primary;
  }

  /** Returns the rehydrated prefix that is safe to emit now (may be empty if
   *  everything is still sitting in the suffix buffer). */
  private appendToBlock(index: number, newText: string): string {
    const buf = this.blocks.get(index) ?? { pending: '' };
    const combined = buf.pending + newText;

    if (combined.length <= this.safeSuffix) {
      buf.pending = combined;
      this.blocks.set(index, buf);
      return '';
    }

    const boundary = combined.length - this.safeSuffix;
    const toEmit = combined.slice(0, boundary);
    buf.pending = combined.slice(boundary);
    this.blocks.set(index, buf);
    return this.rehydrate(toEmit);
  }

  private drainBlockText(index: number): string {
    const buf = this.blocks.get(index);
    if (!buf || buf.pending.length === 0) {
      this.blocks.delete(index);
      return '';
    }
    const out = this.rehydrate(buf.pending);
    this.blocks.delete(index);
    return out;
  }

  private drainBlock(index: number, emitAsDelta: boolean): string {
    const tail = this.drainBlockText(index);
    if (tail.length === 0) return '';
    if (!emitAsDelta) return '';
    if (this.format === 'anthropic') {
      return buildAnthropicDelta(index, tail);
    }
    return buildOpenaiSyntheticContent(tail, this.openaiCompletionId, this.openaiModel);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function numIndex(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function extractDataPayload(raw: string): string | null {
  const lines = raw.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  return dataLines.length === 0 ? null : dataLines.join('\n');
}

function buildAnthropicDelta(index: number, text: string): string {
  const body = {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(body)}\n\n`;
}

function buildOpenaiChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function buildOpenaiSyntheticContent(
  text: string,
  id: string | null,
  model: string | null,
): string {
  const payload: Record<string, unknown> = {
    id: id ?? 'chatcmpl-ainonymity-flush',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
  if (model) payload['model'] = model;
  return `data: ${JSON.stringify(payload)}\n\n`;
}
