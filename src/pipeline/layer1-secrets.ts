import { matchSecrets, matchSecretsEnhanced } from '../patterns/secrets.js';
import { runPatterns, type PatternMatch, type PatternRule } from '../patterns/utils.js';
import { removeOverlaps } from './utils.js';
import { log } from '../logger.js';
import type { Layer, PipelineContext, AnonymizeResult, Replacement } from '../types.js';

const REDACTED = '***REDACTED***';

export class SecretsLayer implements Layer {
  readonly name = 'secrets' as const;

  process(text: string, ctx: PipelineContext): AnonymizeResult {
    const hits = matchSecrets(text);
    this.addCustomPatterns(hits, text, ctx);
    return this.applyRedactions(text, hits);
  }

  async processAsync(text: string, ctx: PipelineContext): Promise<AnonymizeResult> {
    const hits = await matchSecretsEnhanced(text);
    this.addCustomPatterns(hits, text, ctx);
    return this.applyRedactions(text, hits);
  }

  private addCustomPatterns(hits: PatternMatch[], text: string, ctx: PipelineContext): void {
    const rules: PatternRule[] = [];
    for (const pat of ctx.config.secrets.patterns) {
      try {
        rules.push({ type: pat.name, regex: new RegExp(pat.regex, 'g') });
      } catch (err) {
        log.warn('skipping invalid secret pattern', {
          pattern: pat.name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (rules.length > 0) {
      hits.push(...runPatterns(text, rules));
    }
  }

  private applyRedactions(text: string, hits: PatternMatch[]): AnonymizeResult {
    if (hits.length === 0) {
      return { text, replacements: [] };
    }

    const deduped = removeOverlaps(hits);
    deduped.sort((a, b) => b.offset - a.offset);

    let result = text;
    const replacements: Replacement[] = [];

    for (const hit of deduped) {
      result = result.slice(0, hit.offset) + REDACTED + result.slice(hit.offset + hit.length);

      replacements.push({
        original: hit.match,
        pseudonym: REDACTED,
        layer: 'secrets',
        type: hit.type,
        offset: hit.offset,
        length: hit.length,
      });
    }

    return { text: result, replacements };
  }
}
