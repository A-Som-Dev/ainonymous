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
    return this.applyRedactions(text, this.filterDisabled(hits, ctx));
  }

  async processAsync(text: string, ctx: PipelineContext): Promise<AnonymizeResult> {
    const hits = await matchSecretsEnhanced(text, { filters: ctx.orFilters });
    this.addCustomPatterns(hits, text, ctx);
    const pluginHits = await this.runDetectorPlugins(text, ctx);
    if (pluginHits.length > 0) hits.push(...pluginHits);
    return this.applyRedactions(text, this.filterDisabled(hits, ctx));
  }

  private filterDisabled(hits: PatternMatch[], ctx: PipelineContext): PatternMatch[] {
    const dis = ctx.disabledDetectorIds;
    if (!dis || dis.size === 0) return hits;
    return hits.filter((h) => {
      if (dis.has(h.type)) return false;
      const m = /^plugin:([^:]+):/.exec(h.type);
      return !(m && dis.has(m[1]));
    });
  }

  private async runDetectorPlugins(text: string, ctx: PipelineContext): Promise<PatternMatch[]> {
    const reg = ctx.detectorRegistry;
    if (!reg) return [];
    const aggression = ctx.config.behavior.aggression ?? 'medium';
    const preset = (ctx.config.behavior.compliance ?? '').toLowerCase();
    const out = await reg.detectByCapability(
      ['secrets'],
      text,
      { aggression, preset },
      (id, err) => log.warn('detector plugin threw', { id, err: String(err) }),
    );
    return out.map((h) => ({
      type: h.type,
      match: h.match,
      offset: h.offset,
      length: h.length,
    }));
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
