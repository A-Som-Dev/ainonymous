import { log } from '../logger.js';
import {
  buildAnthropicDelta,
  anthropicDeltaKind,
  buildOpenaiChunk,
  buildOpenaiSyntheticContent,
} from './stream-formats/index.js';
import type { AnthropicDeltaKind } from './stream-formats/index.js';

export type StreamFormat = 'anthropic' | 'openai';

type RehydrateFn = (text: string) => string;

interface BlockBuf {
  pending: string;
  kind: AnthropicDeltaKind;
}

/** Bridges chunked SSE streams and the text-based rehydrator. Pseudonyms may
 *  arrive split across multiple `text_delta` events (e.g. "Alpha" | "Corp" |
 *  "Service"). Running rehydrate on each fragment finds nothing. The solution
 *  here: per content-block, keep a sliding suffix buffer large enough to hold
 *  any pseudonym in the session map, then rehydrate only the prefix that can
 *  no longer be a split token. On block/stream end the tail is flushed.
 */
const MAX_LEFTOVER_BYTES = 1 * 1024 * 1024;

export interface StreamRehydratorOptions {
  /** Emit text up to a sentence-like boundary (`\n`, `. `, `! `, `? `) as
   *  soon as it is complete, instead of holding every char for safeSuffix
   *  bytes. Trade-off: a pseudonym split across a boundary may leak through
   *  unrehydrated. Documented as opt-in for pair-programming flows. */
  eagerFlush?: boolean;
}

const WS_RE = /\s/;

export class StreamRehydrator {
  private readonly format: StreamFormat;
  private readonly rehydrate: RehydrateFn;
  private readonly safeSuffix: number;
  private readonly eagerFlush: boolean;
  private leftover = '';
  private readonly blocks = new Map<number, BlockBuf>();
  // OpenAI has only a single logical stream - we treat it as block index 0.
  private readonly openaiBlockIndex = 0;
  /** Remember the upstream chat-completion id so the synthetic flush chunk
   *  looks like a real one from the same completion. */
  private openaiCompletionId: string | null = null;
  private openaiModel: string | null = null;

  constructor(
    format: StreamFormat,
    rehydrate: RehydrateFn,
    safeSuffix: number,
    opts: StreamRehydratorOptions = {},
  ) {
    this.format = format;
    this.rehydrate = rehydrate;
    this.safeSuffix = Math.max(16, safeSuffix);
    this.eagerFlush = opts.eagerFlush === true;
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

    if (this.leftover.length > MAX_LEFTOVER_BYTES) {
      log.warn('stream-rehydrator leftover buffer exceeded cap, flushing raw', {
        length: this.leftover.length,
        cap: MAX_LEFTOVER_BYTES,
      });
      out += this.leftover;
      this.leftover = '';
    }

    return out;
  }

  /** Drains all remaining buffered text (per-block pending + stream leftover).
   *  Must be called once upstream signals end-of-stream. */
  flush(): string {
    let out = '';
    // Unterminated leftover from a truncated stream gets a final rehydrate
    // pass over the whole buffer. The previous `includes('data:')` branch
    // routed through `handleEvent`, which falls back to raw passthrough on
    // any JSON-parse failure - and a truncated chunk is by definition a
    // parse failure. Running rehydrate over the raw bytes is safe: it only
    // substitutes known pseudonyms, SSE control syntax passes through
    // unchanged, and a pseudonym that landed in the last chunk still
    // resolves back to the original instead of leaking.
    if (this.leftover.length > 0) {
      out += this.rehydrate(this.leftover);
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
      if (!isObj(delta)) return raw;
      const kindInfo = anthropicDeltaKind(delta);
      if (kindInfo === null) return raw;
      const { kind, text } = kindInfo;
      // input_json_delta fragments carry raw JSON syntax. Running the
      // plain-string rehydrator on them risks producing unbalanced quotes
      // when an original contains " or \. Forward unchanged; tool_use
      // arguments should not carry pseudonyms in the first place.
      if (kind === 'input_json_delta') return raw;

      const emit = this.appendToBlock(index, text, kind);
      if (!emit) return ''; // fully buffered, no delta to forward yet
      return buildAnthropicDelta(index, emit, kind);
    }

    if (type === 'content_block_stop') {
      const index = numIndex(payload['index']);
      const buf = this.blocks.get(index);
      const kind = buf?.kind ?? 'text_delta';
      const tail = this.drainBlockText(index);
      if (tail.length === 0) return raw;
      // Emit the flushed tail as its own extra delta immediately before the
      // stop event so the client sees the complete rehydrated text. The
      // original stop event is forwarded unchanged after.
      return buildAnthropicDelta(index, tail, kind) + raw;
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
      const emit = this.appendToBlock(this.openaiBlockIndex, content, 'text_delta');
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
  private appendToBlock(index: number, newText: string, kind: AnthropicDeltaKind): string {
    const buf: BlockBuf = this.blocks.get(index) ?? { pending: '', kind };
    buf.kind = kind;
    const combined = buf.pending + newText;

    if (this.eagerFlush && kind === 'text_delta') {
      const cutAt = lastEagerBoundary(combined, combined.length - this.safeSuffix);
      // Pseudonyms (IPv4 `10.0.0.1`, addresses `Beispielweg 1,`) can contain
      // boundary characters. If a pseudonym straddles the chosen cut point,
      // postpone the flush until the safeSuffix guarantees it is complete.
      if (cutAt > 0) {
        const toEmit = combined.slice(0, cutAt);
        const rehydrated = this.rehydrate(toEmit);
        if (rehydrated.length > 0 && !mightSplitPseudonym(rehydrated, cutAt, combined)) {
          buf.pending = combined.slice(cutAt);
          this.blocks.set(index, buf);
          return rehydrated;
        }
      }
    }

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
    const buf = this.blocks.get(index);
    const kind = buf?.kind ?? 'text_delta';
    const tail = this.drainBlockText(index);
    if (tail.length === 0) return '';
    if (!emitAsDelta) return '';
    if (this.format === 'anthropic') {
      return buildAnthropicDelta(index, tail, kind);
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

function mightSplitPseudonym(emitted: string, cutAt: number, combined: string): boolean {
  // Heuristic guard: if emitted text still looks like an open pseudonym token
  // (ends with digits/alnum connected across the cut), fall back to the
  // slow path. Conservative: may over-hold rare tokens, but never leaks.
  if (emitted.length === 0 || cutAt >= combined.length) return false;
  const tail = emitted.slice(-1);
  const head = combined[cutAt];
  return /[A-Za-z0-9.:-]/.test(tail) && /[A-Za-z0-9.:-]/.test(head);
}

/**
 * Highest index i >= max(minIndex, 1) such that the text ending at position i
 * closes a sentence-like boundary (`\n`, or `[.!?]` followed by whitespace).
 * Returns 0 when no qualifying boundary exists in the scan window. Scanning
 * only the trailing `combined.length - minIndex + 1` characters keeps this
 * O(safeSuffix) per push instead of the old O(combined.length).
 */
function lastEagerBoundary(s: string, minIndex: number): number {
  const start = Math.max(minIndex, 1);
  for (let i = s.length; i >= start; i--) {
    const c = s[i - 1];
    if (c === '\n') return i;
    if (i >= 2) {
      const prev = s[i - 2];
      if ((prev === '.' || prev === '!' || prev === '?') && WS_RE.test(c)) return i;
    }
  }
  return 0;
}
