import { PseudoGen } from '../pseudo.js';
import { matchPII, matchPIIEnhanced } from '../patterns/pii.js';
import { matchInfra, matchInfraEnhanced } from '../patterns/infra.js';
import { detectNames } from '../patterns/ner.js';
import type { PatternMatch } from '../patterns/utils.js';
import { normalizeForDetection, mapMatchToOriginal } from '../patterns/normalize.js';
import { removeOverlaps } from './utils.js';
import type { Layer, PipelineContext, AnonymizeResult, Replacement } from '../types.js';

export class IdentityLayer implements Layer {
  readonly name = 'identity' as const;

  private gen: PseudoGen;

  constructor(gen?: PseudoGen) {
    this.gen = gen ?? new PseudoGen();
  }

  process(text: string, ctx: PipelineContext): AnonymizeResult {
    const configResult = this.applyConfigReplacements(text, ctx);
    const piiHits = matchPII(configResult.text);
    const infraHits = matchInfra(configResult.text);
    const patternResult = this.applyPatternHits(
      configResult.text,
      [...piiHits, ...infraHits],
      configResult.replacements,
      ctx,
    );
    return this.applyNerHits(patternResult.text, patternResult.replacements, ctx);
  }

  async processAsync(text: string, ctx: PipelineContext): Promise<AnonymizeResult> {
    const configResult = this.applyConfigReplacements(text, ctx);
    const preset = ctx.config.behavior.compliance;
    const [piiHits, infraHits] = await Promise.all([
      matchPIIEnhanced(configResult.text, preset),
      matchInfraEnhanced(configResult.text),
    ]);
    const patternResult = this.applyPatternHits(
      configResult.text,
      [...piiHits, ...infraHits],
      configResult.replacements,
      ctx,
    );
    return this.applyNerHits(patternResult.text, patternResult.replacements, ctx);
  }

  private applyConfigReplacements(
    text: string,
    ctx: PipelineContext,
  ): { text: string; replacements: Replacement[] } {
    const { identity } = ctx.config;
    let result = text;
    const replacements: Replacement[] = [];

    if (identity.company) {
      result = this.replaceAll(
        result,
        identity.company,
        () => this.resolve(identity.company, 'company', ctx),
        'company',
        replacements,
      );
    }

    for (const domain of identity.domains) {
      result = this.replaceAll(
        result,
        domain,
        () => this.resolve(domain, 'domain', ctx),
        'domain',
        replacements,
      );
    }

    for (const person of identity.people) {
      result = this.replaceAll(
        result,
        person,
        () => this.resolve(person, 'person', ctx),
        'person',
        replacements,
      );
    }

    return { text: result, replacements };
  }

  private applyPatternHits(
    text: string,
    allHits: PatternMatch[],
    replacements: Replacement[],
    ctx: PipelineContext,
  ): AnonymizeResult {
    let result = text;

    if (allHits.length > 0) {
      const deduped = removeOverlaps(allHits);
      deduped.sort((a, b) => b.offset - a.offset);

      for (const hit of deduped) {
        const pseudo = this.pseudoFor(hit, ctx);
        if (!pseudo) continue;

        result = result.slice(0, hit.offset) + pseudo + result.slice(hit.offset + hit.length);

        replacements.push({
          original: hit.match,
          pseudonym: pseudo,
          layer: 'identity',
          type: hit.type,
          offset: hit.offset,
          length: hit.length,
        });
      }
    }

    return { text: result, replacements };
  }

  private applyNerHits(
    text: string,
    replacements: Replacement[],
    ctx: PipelineContext,
  ): AnonymizeResult {
    const nameHits = detectNames(text);
    if (nameHits.length === 0) return { text, replacements };

    let result = text;

    // Filter out names that overlap with already-replaced ranges
    const replacedRanges = replacements
      .filter((r) => r.layer === 'identity')
      .map((r) => [r.offset, r.offset + r.length] as [number, number]);

    const fresh = nameHits.filter((hit) => {
      return !replacedRanges.some(([s, e]) => hit.offset < e && hit.offset + hit.length > s);
    });

    if (fresh.length === 0) return { text, replacements };

    // Apply in reverse offset order to preserve positions
    const sorted = [...fresh].sort((a, b) => b.offset - a.offset);

    for (const hit of sorted) {
      const existing = ctx.sessionMap.getByOriginal(hit.name);
      const pseudo = existing ?? this.gen.person(hit.name);

      if (!existing) {
        ctx.sessionMap.set(hit.name, pseudo, 'identity', 'person-name-ner');
      }

      result = result.slice(0, hit.offset) + pseudo + result.slice(hit.offset + hit.length);

      replacements.push({
        original: hit.name,
        pseudonym: pseudo,
        layer: 'identity',
        type: 'person-name-ner',
        offset: hit.offset,
        length: hit.length,
      });
    }

    return { text: result, replacements };
  }

  private resolve(original: string, kind: string, ctx: PipelineContext): string {
    const existing = ctx.sessionMap.getByOriginal(original);
    if (existing) return existing;

    let pseudo: string;
    switch (kind) {
      case 'company':
        pseudo = this.gen.identifier(original);
        break;
      case 'domain':
        pseudo = this.gen.domain(original);
        break;
      case 'person':
        pseudo = this.gen.person(original);
        break;
      default:
        pseudo = this.gen.identifier(original);
    }

    ctx.sessionMap.set(original, pseudo, 'identity', kind);
    return pseudo;
  }

  private pseudoFor(hit: PatternMatch, ctx: PipelineContext): string | null {
    const existing = ctx.sessionMap.getByOriginal(hit.match);
    if (existing) return existing;

    let pseudo: string;

    switch (hit.type) {
      case 'email':
        pseudo = this.gen.email(hit.match);
        break;
      case 'ipv4':
        pseudo = this.gen.ipv4(hit.match);
        break;
      case 'phone':
        pseudo = '+49 30 000-' + String(ctx.sessionMap.size + 1).padStart(4, '0');
        break;
      case 'iban':
        pseudo = 'DE00 0000 0000 0000 0000 ' + String(ctx.sessionMap.size + 1).padStart(2, '0');
        break;
      case 'hostname-internal':
      case 'internal-url':
        pseudo = this.gen.domain(hit.match);
        break;
      case 'credit-card': {
        const suffix = String(ctx.sessionMap.size + 1).padStart(4, '0');
        pseudo = `****-****-****-${suffix}`;
        break;
      }
      case 'address':
        pseudo = `Beispielweg ${ctx.sessionMap.size + 1}, 10000 Berlin`;
        break;
      case 'tax-id':
        pseudo = '00/000/00000';
        break;
      case 'sozialversicherung':
        pseudo = '00 000000 A 000';
        break;
      case 'personalausweis':
        pseudo = 'L' + String(ctx.sessionMap.size + 1).padStart(9, '0');
        break;
      case 'national-insurance-uk':
        pseudo = 'AA 00 00 00 A';
        break;
      case 'nhs-number':
        pseudo = '000 000 ' + String(ctx.sessionMap.size + 1).padStart(4, '0');
        break;
      case 'person-name':
      case 'name':
        pseudo = this.gen.person(hit.match);
        break;
      case 'date-of-birth':
        pseudo = '01.01.1990';
        break;
      case 'mac':
        pseudo = '00:00:00:00:00:' + String(ctx.sessionMap.size + 1).padStart(2, '0');
        break;
      case 'ipv6':
        pseudo = '::1';
        break;
      default:
        pseudo = '***ANONYMIZED***';
        break;
    }

    ctx.sessionMap.set(hit.match, pseudo, 'identity', hit.type);
    return pseudo;
  }

  private replaceAll(
    text: string,
    search: string,
    getPseudo: () => string,
    type: string,
    replacements: Replacement[],
  ): string {
    if (!text || !search) return text;

    // Normalize both sides so zero-width / fullwidth / ligature injections
    // do not slip past the simple substring match. For pure ASCII this
    // reduces to an identity map so the hot path stays cheap.
    const n = normalizeForDetection(text);
    const searchN = normalizeForDetection(search).normalized;
    if (searchN.length === 0 || !n.normalized.includes(searchN)) return text;

    const hits: Array<{ start: number; length: number }> = [];
    let cursor = 0;
    while (true) {
      const pos = n.normalized.indexOf(searchN, cursor);
      if (pos === -1) break;
      const mapped = mapMatchToOriginal(n, pos, searchN.length);
      if (mapped.length > 0) hits.push(mapped);
      cursor = pos + searchN.length;
    }

    if (hits.length === 0) return text;

    const pseudo = getPseudo();
    const reverse = [...hits].sort((a, b) => b.start - a.start);
    let result = text;
    for (const h of reverse) {
      result = result.slice(0, h.start) + pseudo + result.slice(h.start + h.length);
    }

    for (const h of hits) {
      replacements.push({
        original: text.slice(h.start, h.start + h.length),
        pseudonym: pseudo,
        layer: 'identity',
        type,
        offset: h.start,
        length: h.length,
      });
    }

    return result;
  }
}
