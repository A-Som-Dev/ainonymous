import { PseudoGen } from '../pseudo.js';
import { matchPII, matchPIIEnhanced } from '../patterns/pii.js';
import { matchInfra, matchInfraEnhanced } from '../patterns/infra.js';
import { detectNames } from '../patterns/ner.js';
import type { PatternMatch } from '../patterns/utils.js';
import { normalizeForDetection, mapMatchToOriginal } from '../patterns/normalize.js';
import { removeOverlaps } from './utils.js';
import { log } from '../logger.js';
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
    const [piiHits, infraHits, pluginHits] = await Promise.all([
      matchPIIEnhanced(configResult.text, preset, { filters: ctx.orFilters }),
      matchInfraEnhanced(configResult.text, { filters: ctx.orFilters }),
      this.runDetectorPlugins(configResult.text, ctx),
    ]);
    const combined = this.filterDisabled([...piiHits, ...infraHits, ...pluginHits], ctx);
    const patternResult = this.applyPatternHits(
      configResult.text,
      combined,
      configResult.replacements,
      ctx,
    );
    return this.applyNerHits(patternResult.text, patternResult.replacements, ctx);
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
      ['pii', 'infra'],
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

  private applyConfigReplacements(
    text: string,
    ctx: PipelineContext,
  ): { text: string; replacements: Replacement[] } {
    const { identity } = ctx.config;
    let result = text;
    const replacements: Replacement[] = [];

    // Longest token first. Company-before-domain would substring-match the
    // company inside the domain, leaving a half-replaced email as the
    // session-map key and blocking cascade rehydration.
    type Entry = { value: string; kind: 'company' | 'domain' | 'person'; variants: string[] };
    const entries: Entry[] = [];
    if (identity.company)
      entries.push({ value: identity.company, kind: 'company', variants: [identity.company] });
    for (const d of identity.domains) entries.push({ value: d, kind: 'domain', variants: [d] });
    for (const p of identity.people) {
      const tokens = p.trim().split(/\s+/);
      const variants = new Set<string>([p]);
      if (tokens.length === 2) variants.add(`${tokens[1]} ${tokens[0]}`);
      entries.push({ value: p, kind: 'person', variants: [...variants] });
    }
    entries.sort((a, b) => b.value.length - a.value.length);

    for (const entry of entries) {
      let pseudo: string | undefined;
      const once = () => (pseudo ??= this.resolve(entry.value, entry.kind, ctx));
      for (const variant of entry.variants) {
        result = this.replaceAll(result, variant, once, entry.kind, replacements);
      }
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
    // Pass 3 (identifier-embedded names) always runs now. aggression=low used
    // to skip it, which leaked `getHunterMuellerData` verbatim.
    const nameHits = detectNames(text);
    if (nameHits.length === 0) return { text, replacements };

    let result = text;

    // Drop hits that already are a known pseudonym (would double-rewrite).
    // The prior offset overlap against `replacements` was wrong: those offsets
    // are from pre-replacement text while NER runs on post-replacement text.
    const candidates = nameHits.filter((hit) => !ctx.sessionMap.getByPseudonym(hit.name));
    if (candidates.length === 0) return { text, replacements };

    // Dedup overlapping NER hits themselves (Pass 2b can yield "Clemens Kurz"
    // + "Kurz Peter" on the same text. without this the reverse-offset
    // slice/replace below would corrupt indices).
    const byOffset = [...candidates].sort((a, b) => a.offset - b.offset);
    const fresh: typeof candidates = [];
    let lastEnd = -1;
    for (const hit of byOffset) {
      if (hit.offset < lastEnd) continue;
      fresh.push(hit);
      lastEnd = hit.offset + hit.length;
    }

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

    // The match may already contain an earlier pseudonym (domain rewritten
    // before the full URL was detected). Resolve back first, otherwise we
    // allocate a duplicate pseudo and rehydrate goes lossy.
    const trueEarly = this.resolveToTrueOriginal(hit.match, ctx);
    if (trueEarly !== hit.match) {
      const aliased = ctx.sessionMap.getByOriginal(trueEarly);
      if (aliased) return aliased;
    }

    let pseudo: string;

    switch (hit.type) {
      case 'email':
        pseudo = this.gen.email(hit.match);
        break;
      case 'ipv4':
        pseudo = this.gen.ipv4(hit.match);
        break;
      case 'phone':
        pseudo = this.gen.phone(hit.match);
        break;
      case 'iban':
        pseudo = this.gen.iban(hit.match);
        break;
      case 'hostname-internal':
      case 'internal-url':
        pseudo = this.gen.domain(hit.match);
        break;
      case 'credit-card':
        pseudo = this.gen.creditCard(hit.match);
        break;
      case 'address':
        pseudo = this.gen.address(hit.match);
        break;
      case 'tax-id':
        pseudo = this.gen.taxId(hit.match);
        break;
      case 'sozialversicherung':
        pseudo = this.gen.sozialversicherung(hit.match);
        break;
      case 'personalausweis':
        pseudo = this.gen.personalausweis(hit.match);
        break;
      case 'national-insurance-uk':
        pseudo = this.gen.ukNationalInsurance(hit.match);
        break;
      case 'nhs-number':
        pseudo = this.gen.nhsNumber(hit.match);
        break;
      case 'person-name':
      case 'name':
        pseudo = this.gen.person(hit.match);
        break;
      case 'date-of-birth':
        pseudo = this.gen.dateOfBirth(hit.match);
        break;
      case 'mac':
        pseudo = this.gen.mac(hit.match);
        break;
      case 'ipv6':
        pseudo = this.gen.ipv6(hit.match);
        break;
      case 'ssn':
        pseudo = this.gen.ssn(hit.match);
        break;
      case 'zip-code-us':
        pseudo = this.gen.zipCodeUs(hit.match);
        break;
      case 'passport-us':
        pseudo = this.gen.passportUs(hit.match);
        break;
      case 'passport-uk':
        pseudo = this.gen.passportUk(hit.match);
        break;
      case 'driving-license-us':
        pseudo = this.gen.drivingLicenseUs(hit.match);
        break;
      case 'driving-license-uk':
        pseudo = this.gen.drivingLicenseUk(hit.match);
        break;
      case 'postcode-uk':
        pseudo = this.gen.postcodeUk(hit.match);
        break;
      case 'canadian-sin':
        pseudo = this.gen.canadianSin(hit.match);
        break;
      case 'australian-tfn':
        pseudo = this.gen.australianTfn(hit.match);
        break;
      case 'australian-medicare':
        pseudo = this.gen.australianMedicare(hit.match);
        break;
      case 'india-aadhaar':
        pseudo = this.gen.indiaAadhaar(hit.match);
        break;
      case 'india-pan':
        pseudo = this.gen.indiaPan(hit.match);
        break;
      case 'brazilian-cpf':
        pseudo = this.gen.brazilianCpf(hit.match);
        break;
      case 'brazilian-cnpj':
        pseudo = this.gen.brazilianCnpj(hit.match);
        break;
      case 'mexican-curp':
        pseudo = this.gen.mexicanCurp(hit.match);
        break;
      case 'mexican-rfc':
        pseudo = this.gen.mexicanRfc(hit.match);
        break;
      case 'south-korean-rrn':
        pseudo = this.gen.southKoreanRrn(hit.match);
        break;
      case 'south-africa-id':
        pseudo = this.gen.southAfricaId(hit.match);
        break;
      case 'hungarian-tax-id':
        pseudo = this.gen.hungarianTaxId(hit.match);
        break;
      case 'hungarian-personal-id':
        pseudo = this.gen.hungarianPersonalId(hit.match);
        break;
      case 'indonesia-nik':
        pseudo = this.gen.indonesiaNik(hit.match);
        break;
      case 'german-tax-id':
        pseudo = this.gen.taxId(hit.match);
        break;
      case 'ticket-jira': {
        // Keep the shape `PREFIX-N` but anonymize both parts. The LLM can
        // still tell it's a ticket reference, just not which one.
        pseudo = 'TICKET-' + String(ctx.sessionMap.size + 1).padStart(4, '0');
        break;
      }
      case 'ticket-hash':
        pseudo = '#' + String(ctx.sessionMap.size + 1).padStart(4, '0');
        break;
      case 'tech-version': {
        // Keep the brand, drop the version. `Spring Boot 3.2` becomes
        // `Spring Boot`. The LLM still knows the stack, the attacker doesn't
        // know the minor/patch for CVE targeting.
        const parts = trueEarly.split(/\s+/);
        // Drop the last whitespace-delimited token if it looks like a version.
        if (parts.length >= 2 && /^\d+(?:\.\d+)*[a-z]?$/.test(parts[parts.length - 1])) {
          pseudo = parts.slice(0, -1).join(' ');
        } else {
          pseudo = trueEarly;
        }
        break;
      }
      default:
        pseudo = '***ANONYMIZED***';
        break;
    }

    ctx.sessionMap.set(trueEarly, pseudo, 'identity', hit.type);
    return pseudo;
  }

  // Cascade a half-replaced match back through the session map so the key we
  // store is the true pre-pipeline original, not the already-partially-
  // anonymised intermediate.
  private resolveToTrueOriginal(semi: string, ctx: PipelineContext): string {
    let out = semi;
    for (const [orig, pseudo] of ctx.sessionMap.entries()) {
      if (orig === semi) continue;
      if (out.includes(pseudo)) out = out.split(pseudo).join(orig);
    }
    return out;
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
