import { PseudoGen } from '../pseudo.js';
import {
  extractIdentifiers,
  extractFunctionBodies,
  extractTopLevelValues,
} from '../ast/extractor.js';
import {
  isLanguageKeyword,
  isTechBrand,
  isTechBrandCaseInsensitive,
  shouldPreserveIdentifier,
} from '../ast/keywords.js';
import { splitIdentifier, escapeRegex, STRUCTURAL_SUFFIXES, pathMatchesAny } from '../shared.js';
import { log } from '../logger.js';
import type { Layer, PipelineContext, AnonymizeResult, Replacement } from '../types.js';

const SUPPORTED_LANGS = new Set([
  'typescript',
  'tsx',
  'javascript',
  'java',
  'python',
  'php',
  'kotlin',
  'go',
  'rust',
  'c_sharp',
  'csharp',
]);

const STRUCTURAL_PREFIXES = new Set([
  'get',
  'set',
  'find',
  'fetch',
  'create',
  'update',
  'delete',
  'remove',
  'validate',
  'handle',
  'process',
  'parse',
  // HTTP verbs. keep REST method names readable. `get`/`delete` were
  // already present; the others are needed so `patchService` doesn't become
  // `betaService` and break the Spring @PatchMapping mental model.
  'patch',
  'post',
  'put',
  'head',
  'options',
  'trace',
  'connect',
  'format',
  'convert',
  'transform',
  'map',
  'filter',
  'reduce',
  'sort',
  'merge',
  'split',
  'join',
  'group',
  'init',
  'setup',
  'teardown',
  'reset',
  'clear',
  'load',
  'save',
  'store',
  'read',
  'write',
  'open',
  'close',
  'start',
  'stop',
  'run',
  'execute',
  'send',
  'receive',
  'emit',
  'listen',
  'subscribe',
  'unsubscribe',
  'publish',
  'check',
  'verify',
  'assert',
  'test',
  'is',
  'has',
  'can',
  'should',
  'to',
  'from',
  'with',
  'by',
  'on',
  'of',
  'for',
  'in',
  'at',
  'build',
  'make',
  'new',
  'add',
  'append',
  'insert',
  'push',
  'pop',
  'apply',
  'resolve',
  'reject',
  'throw',
  'catch',
  'try',
  'log',
  'print',
  'render',
  'display',
  'show',
  'hide',
  'enable',
  'disable',
  'toggle',
  'register',
  'unregister',
  'bind',
  'unbind',
  'attach',
  'detach',
  'calculate',
  'compute',
  'count',
  'measure',
  'compare',
  'match',
  'search',
  'extract',
  'collect',
  'aggregate',
  'normalize',
  'sanitize',
  'escape',
]);

export class CodeLayer implements Layer {
  readonly name = 'code' as const;

  private gen: PseudoGen;

  constructor(gen?: PseudoGen) {
    this.gen = gen ?? new PseudoGen();
  }

  process(text: string, ctx: PipelineContext): AnonymizeResult {
    const { domainTerms } = ctx.config.code;
    const preserveSet = new Set(ctx.config.code.preserve);
    let result = text;
    const replacements: Replacement[] = [];

    for (const term of domainTerms) {
      if (!result.includes(term)) continue;
      if (preserveSet.has(term)) continue;

      const pseudo = this.resolveTerm(term, ctx);
      const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'g');
      let m: RegExpExecArray | null;

      while ((m = re.exec(result)) !== null) {
        replacements.push({
          original: term,
          pseudonym: pseudo,
          layer: 'code',
          type: 'domain-term',
          offset: m.index,
          length: term.length,
        });
      }

      result = result.replace(re, pseudo);
    }

    return { text: result, replacements };
  }

  async processAsync(text: string, ctx: PipelineContext): Promise<AnonymizeResult> {
    const allReplacements: Replacement[] = [];
    let result = text;
    const preserveSet = new Set(ctx.config.code.preserve);

    // sensitive_paths forces high regardless of the global aggression setting.
    const isSensitive =
      ctx.filePath != null && pathMatchesAny(ctx.filePath, ctx.config.code.sensitivePaths);
    const mode = isSensitive ? 'high' : ctx.config.behavior.aggression;

    if (ctx.filePath && pathMatchesAny(ctx.filePath, ctx.config.code.redactBodies)) {
      result = await this.redactAllBodiesAsync(result, allReplacements, ctx.config.code.language);
    }

    result = this.handleRedactAnnotations(result, allReplacements);

    // See patterns/aggression-modes.md for the full mode matrix and ordering rationale.
    if (mode === 'medium' || mode === 'high') {
      // Package paths first so imports register their pseudonyms before AST walk.
      result = this.handlePackagePaths(result, allReplacements, ctx);
      result = await this.applyAstIdentifiers(result, allReplacements, ctx, preserveSet, mode);
      result = this.applyCompoundDomainTerms(result, allReplacements, ctx, preserveSet);
    } else {
      result = this.applyCompoundDomainTerms(result, allReplacements, ctx, preserveSet);
    }

    result = this.applyStandaloneDomainTerms(result, allReplacements, ctx, preserveSet);

    return { text: result, replacements: allReplacements };
  }

  private async applyAstIdentifiers(
    text: string,
    out: Replacement[],
    ctx: PipelineContext,
    preserveSet: Set<string>,
    mode: 'medium' | 'high' = 'medium',
  ): Promise<string> {
    const lang = ctx.config.code.language;
    let result = text;

    // Infrastructure-only repos detect as 'unknown'; tree-sitter has no
    // grammar for that, the load would throw and the catch below would
    // swallow it. Skip the whole AST step instead so we don't pay the
    // wasm-init cost on every request for those repos.
    if (lang === 'unknown') return result;

    try {
      // Only run tree-sitter on fenced code. Raw prose runs through AST as
      // valid-looking identifiers and rehydrate then substring-collides.
      const fenceSources = extractCodeFenceSources(result);
      const looksLikeCode =
        /^\s*(?:import|from|package|#include|require)\s+\S/m.test(result) ||
        /(?:^|\n)\s*(?:def|class|fn|func)\s+\w+[^\n]*[:({]/.test(result) ||
        /(?:^|\n)\s*(?:const|let|var|pub|public|private|protected)\s+\w+\s*[:=(]/.test(result) ||
        (/\{[\s\S]*?\}/.test(result) &&
          /\b(?:class|interface|struct|enum|function|def|fn|func|package|public|private|protected|return|if|for|while)\b/.test(
            result,
          ));
      const sources = fenceSources.length > 0 ? fenceSources : looksLikeCode ? [result] : [];
      const ids = (
        await Promise.all(
          sources.map((src) => extractIdentifiers(src, lang, ctx.config.code.preserve, { mode })),
        )
      ).flat();

      // Inline-backtick tokens bypass the fence-based AST, handle them explicitly.
      for (const token of extractInlineCodeTokens(result)) {
        ids.push({ name: token, kind: 'inline', line: 0, column: 0 });
      }
      const replMap = new Map<string, string>();

      for (const id of ids) {
        if (replMap.has(id.name)) continue;
        if (preserveSet.has(id.name)) continue;
        if (shouldPreserveIdentifier(id.name, lang)) continue;
        const pseudo = this.pseudoFor(id.name, id.kind, ctx, lang);
        if (pseudo && pseudo !== id.name) {
          replMap.set(id.name, pseudo);
        }
      }

      // Stale session entries must not override the current preserve list or
      // rewrite language keywords / framework annotations.
      for (const [orig, pseudo] of ctx.sessionMap.entries()) {
        if (preserveSet.has(orig)) continue;
        if (shouldPreserveIdentifier(orig, lang)) continue;
        if (!replMap.has(orig) && result.includes(orig)) {
          replMap.set(orig, pseudo);
        }
      }

      result = this.applyReplacementMap(result, replMap, out, 'identifier');
    } catch (err) {
      if (SUPPORTED_LANGS.has(lang)) {
        log.error('AST identifier extraction failed', {
          lang,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  private applyCompoundDomainTerms(
    text: string,
    out: Replacement[],
    ctx: PipelineContext,
    preserveSet: Set<string>,
  ): string {
    let result = text;
    for (const term of ctx.config.code.domainTerms) {
      if (!result.includes(term)) continue;

      const compound = new RegExp(`\\b([a-zA-Z]*${escapeRegex(term)}[a-zA-Z]*)\\b`, 'g');
      const compoundMap = new Map<string, string>();

      let cm: RegExpExecArray | null;
      while ((cm = compound.exec(result)) !== null) {
        const full = cm[1];
        if (compoundMap.has(full)) continue;
        if (preserveSet.has(full)) continue;
        const pseudo = this.pseudoFor(full, 'identifier', ctx);
        if (pseudo && pseudo !== full) {
          compoundMap.set(full, pseudo);
        }
      }

      result = this.applyReplacementMap(result, compoundMap, out, 'domain-term');
    }
    return result;
  }

  private applyStandaloneDomainTerms(
    text: string,
    out: Replacement[],
    ctx: PipelineContext,
    preserveSet: Set<string>,
  ): string {
    const lookup = new Map<string, string>();
    for (const term of ctx.config.code.domainTerms) {
      if (preserveSet.has(term)) continue;
      if (!text.includes(term)) continue;
      lookup.set(term, this.resolveTerm(term, ctx));
    }
    if (lookup.size === 0) return text;

    const sorted = [...lookup.keys()].sort((a, b) => b.length - a.length);
    const combined = new RegExp(`\\b(?:${sorted.map(escapeRegex).join('|')})\\b`, 'g');

    let m: RegExpExecArray | null;
    while ((m = combined.exec(text)) !== null) {
      const matched = m[0];
      const pseudo = lookup.get(matched);
      if (pseudo === undefined) continue;
      out.push({
        original: matched,
        pseudonym: pseudo,
        layer: 'code',
        type: 'domain-term',
        offset: m.index,
        length: matched.length,
      });
    }

    combined.lastIndex = 0;
    return text.replace(combined, (match) => lookup.get(match) ?? match);
  }

  private applyReplacementMap(
    text: string,
    map: Map<string, string>,
    out: Replacement[],
    type: string,
  ): string {
    if (map.size === 0) return text;

    // Sort by length desc so alternation prefers longer matches
    // (regex engines pick the first successful alternative left-to-right).
    const sorted = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
    const lookup = new Map(sorted);
    const alternation = sorted.map(([orig]) => escapeRegex(orig)).join('|');
    const combined = new RegExp(`\\b(?:${alternation})\\b`, 'g');

    let m: RegExpExecArray | null;
    while ((m = combined.exec(text)) !== null) {
      const pseudo = lookup.get(m[0]);
      if (pseudo === undefined) continue;
      out.push({
        original: m[0],
        pseudonym: pseudo,
        layer: 'code',
        type,
        offset: m.index,
        length: m[0].length,
      });
    }

    combined.lastIndex = 0;
    return text.replace(combined, (match) => lookup.get(match) ?? match);
  }

  private handlePackagePaths(text: string, out: Replacement[], ctx: PipelineContext): string {
    const company = ctx.config.identity.company?.toLowerCase();
    if (!company) return text;
    const lang = ctx.config.code.language;

    // match reverse-domain patterns: tld.company.project[.sub...]
    // Covers common ccTLDs, gTLDs, and new gTLDs used in enterprise Java packages
    const tlds = [
      'com',
      'org',
      'net',
      'io',
      'co',
      'info',
      'biz',
      'app',
      'dev',
      'cloud',
      'de',
      'at',
      'ch',
      'eu',
      'uk',
      'fr',
      'es',
      'it',
      'nl',
      'be',
      'se',
      'no',
      'dk',
      'fi',
      'pl',
      'cz',
      'ru',
      'us',
      'ca',
      'au',
      'nz',
      'jp',
      'cn',
      'in',
      'br',
      'mx',
    ];
    const pkgRe = new RegExp(
      `\\b(${tlds.join('|')})\\.${escapeRegex(company)}(\\.[a-z][a-z0-9_]*)+\\b`,
      'gi',
    );

    let result = text;
    const replacements = new Map<string, string>();

    let m: RegExpExecArray | null;
    while ((m = pkgRe.exec(result)) !== null) {
      const full = m[0];
      if (replacements.has(full)) continue;

      const parts = full.split('.');
      const anonymized = parts
        .map((part, i) => {
          if (i === 0) return part; // TLD preserved
          const isLast = i === parts.length - 1;
          const isPascal = /^[A-Z]/.test(part);
          // Last segment of a java-style import may be the class name itself
          // (`import com.acme.pkg.FooService;`). Route it through pseudoFor so
          // it shares a stem with the class declaration and its usages.
          if (isLast && isPascal) {
            return this.pseudoFor(part, 'class', ctx, lang) ?? part;
          }
          return this.resolveTerm(part, ctx, lang);
        })
        .join('.');

      replacements.set(full, anonymized);
    }

    const sorted = [...replacements.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [original, pseudo] of sorted) {
      const re = new RegExp(escapeRegex(original), 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(result)) !== null) {
        out.push({
          original,
          pseudonym: pseudo,
          layer: 'code',
          type: 'package-path',
          offset: match.index,
          length: original.length,
        });
      }
      result = result.replace(re, pseudo);
    }

    return result;
  }

  private redactAllBodies(text: string, out: Replacement[]): string {
    let result = text;
    const fnPattern =
      /\b(function\s+\w+\s*\([^)]*\)|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function\s*)?\([^)]*\)\s*=>?)\s*\{/g;
    let match: RegExpExecArray | null;
    const edits: Array<{ start: number; end: number; replacement: string }> = [];

    while ((match = fnPattern.exec(result)) !== null) {
      const bracePos = result.indexOf('{', match.index + match[0].length - 1);
      if (bracePos === -1) continue;
      const bodyEnd = findMatchingBrace(result, bracePos);
      if (bodyEnd === -1) continue;

      const bodyContent = result.slice(bracePos + 1, bodyEnd);
      const redacted = ' /* redacted */ ';
      edits.push({ start: bracePos + 1, end: bodyEnd, replacement: redacted });
      out.push({
        original: bodyContent,
        pseudonym: redacted,
        layer: 'code',
        type: 'redacted-body',
        offset: bracePos + 1,
        length: bodyContent.length,
      });
    }

    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i];
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    }
    return result;
  }

  private async redactAllBodiesAsync(
    text: string,
    out: Replacement[],
    lang: string,
  ): Promise<string> {
    const isJsLike = lang === 'typescript' || lang === 'tsx' || lang === 'javascript';

    // try AST-based body detection first
    try {
      const bodies = await extractFunctionBodies(text, lang);
      const values = await extractTopLevelValues(text, lang);

      if (bodies.length > 0 || values.length > 0) {
        const isPython = lang === 'python';
        type Edit = {
          start: number;
          end: number;
          strategy: 'python-body' | 'brace-body' | 'expr-body' | 'value';
        };
        const edits: Edit[] = [];
        for (const b of bodies) {
          if (isPython) {
            edits.push({ start: b.start, end: b.end, strategy: 'python-body' });
          } else {
            const bodyText = text.slice(b.start, b.end);
            const strategy: Edit['strategy'] = bodyText.trimStart().startsWith('{')
              ? 'brace-body'
              : 'expr-body';
            edits.push({ start: b.start, end: b.end, strategy });
          }
        }
        for (const v of values) {
          edits.push({ start: v.start, end: v.end, strategy: 'value' });
        }

        edits.sort((a, b) => a.start - b.start);
        const filtered: Edit[] = [];
        for (const e of edits) {
          const last = filtered[filtered.length - 1];
          if (last && e.start < last.end) continue;
          filtered.push(e);
        }

        let result = text;
        // reverse order so offsets stay valid
        for (let i = filtered.length - 1; i >= 0; i--) {
          const edit = filtered[i];
          if (edit.strategy === 'python-body') {
            const content = result.slice(edit.start, edit.end);
            const redacted = '\n    pass  # redacted\n';
            out.push({
              original: content,
              pseudonym: redacted,
              layer: 'code',
              type: 'redacted-body',
              offset: edit.start,
              length: content.length,
            });
            result = result.slice(0, edit.start) + redacted + result.slice(edit.end);
          } else if (edit.strategy === 'brace-body') {
            const innerStart = edit.start + 1;
            const innerEnd = edit.end - 1;
            const content = result.slice(innerStart, innerEnd);
            const redacted = ' /* redacted */ ';
            out.push({
              original: content,
              pseudonym: redacted,
              layer: 'code',
              type: 'redacted-body',
              offset: innerStart,
              length: content.length,
            });
            result = result.slice(0, innerStart) + redacted + result.slice(innerEnd);
          } else if (edit.strategy === 'expr-body') {
            // Kotlin-style expression body: `= expr`. Keep `=`, replace the expression.
            const content = result.slice(edit.start, edit.end);
            const prefixMatch = content.match(/^(\s*=\s*)/);
            const prefix = prefixMatch ? prefixMatch[1] : '';
            const redacted = prefix + '"redacted"';
            out.push({
              original: content,
              pseudonym: redacted,
              layer: 'code',
              type: 'redacted-body',
              offset: edit.start,
              length: content.length,
            });
            result = result.slice(0, edit.start) + redacted + result.slice(edit.end);
          } else {
            const content = result.slice(edit.start, edit.end);
            const redacted = '"redacted"';
            out.push({
              original: content,
              pseudonym: redacted,
              layer: 'code',
              type: 'redacted-value',
              offset: edit.start,
              length: content.length,
            });
            result = result.slice(0, edit.start) + redacted + result.slice(edit.end);
          }
        }

        return result;
      }
    } catch (err) {
      if (SUPPORTED_LANGS.has(lang)) {
        log.warn('AST body extraction failed, falling back', {
          lang,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // JS/TS: regex fallback is safe because the regex matches JS/TS syntax
    if (isJsLike) {
      return this.redactAllBodies(text, out);
    }

    // non-JS/TS with AST failure or no matches: redact entire file rather than
    // leak cleartext through a fallback regex that doesn't understand the language
    const redacted = '/* redacted (file body suppressed due to AST unavailable) */';
    out.push({
      original: text,
      pseudonym: redacted,
      layer: 'code',
      type: 'redacted-file',
      offset: 0,
      length: text.length,
    });
    return redacted;
  }

  private handleRedactAnnotations(text: string, out: Replacement[]): string {
    let result = text;

    // find annotation + function, replace entire body. The legacy
    // `@ainonymity:redact` spelling is still honored so that existing user
    // codebases don't silently lose body-redaction after the rename.
    const linePattern = /\/\/\s*@ainonym(ous|ity):redact\s*\n([^\n]*?\{)/g;
    let match: RegExpExecArray | null;
    let legacyWarned = false;
    const edits: Array<{ start: number; end: number; replacement: string }> = [];

    while ((match = linePattern.exec(result)) !== null) {
      if (match[1] === 'ity' && !legacyWarned) {
        log.warn('legacy @ainonymity:redact annotation detected, rename to @ainonymous:redact');
        legacyWarned = true;
      }
      const bracePos = match.index + match[0].length - 1;
      const bodyEnd = findMatchingBrace(result, bracePos);
      if (bodyEnd === -1) continue;

      const bodyContent = result.slice(bracePos + 1, bodyEnd);
      const redactedBody = ' /* redacted */ ';

      edits.push({
        start: bracePos + 1,
        end: bodyEnd,
        replacement: redactedBody,
      });

      out.push({
        original: bodyContent,
        pseudonym: redactedBody,
        layer: 'code',
        type: 'redacted-body',
        offset: bracePos + 1,
        length: bodyContent.length,
      });
    }

    // apply edits in reverse so offsets stay valid
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i];
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    }

    return result;
  }

  private pseudoFor(
    name: string,
    kind: string,
    ctx: PipelineContext,
    lang?: string,
  ): string | null {
    const existing = ctx.sessionMap.getByOriginal(name);
    if (existing) return existing;

    // Already a pseudonym from a prior step in the pipeline (e.g. package
    // paths ran first and rewrote an import). do not re-pseudonymize.
    if (ctx.sessionMap.getByPseudonym(name)) return name;

    if (shouldPreserveIdentifier(name, lang)) return name;

    const parts = splitIdentifier(name);
    const { domainTerms } = ctx.config.code;
    const domainSet = new Set(domainTerms.map((t) => t.toLowerCase()));
    const sensitive =
      ctx.filePath != null && pathMatchesAny(ctx.filePath, ctx.config.code.sensitivePaths);

    const mapped = parts.map((part) => {
      const lower = part.toLowerCase();

      // Split-level preserve is intentionally narrower than full-identifier
      // preserve: only language keywords (`package`, `class`, `def`) and
      // public technology brands (`Kafka`, `Spring`, `Postgres`) are
      // uncontroversial. generic annotations like `@Order` or `@Query`
      // would wrongly freeze legitimate domain terms embedded in compound
      // names.
      if (isLanguageKeyword(part, lang) || isLanguageKeyword(lower, lang)) {
        return { text: part, isDomain: false };
      }
      // Tech brands preserve across casing so `oracleClient` keeps the
      // `oracle` stem. Explicit whitelist, not length-based, because `next`
      // / `vault` / `git` collide with common English words.
      if (isTechBrand(part) || isTechBrandCaseInsensitive(part)) {
        return { text: part, isDomain: false };
      }
      if (!sensitive && STRUCTURAL_SUFFIXES.has(lower)) return { text: part, isDomain: false };
      if (!sensitive && STRUCTURAL_PREFIXES.has(lower)) return { text: part, isDomain: false };
      if (domainSet.has(lower)) return { text: part, isDomain: true };

      // in sensitive mode or for unknown parts, treat as domain
      return { text: part, isDomain: true };
    });

    const hasDomain = mapped.some((p) => p.isDomain);
    if (!hasDomain) return name;

    const rebuilt = mapped
      .map((p) => {
        if (!p.isDomain) return p.text;
        return this.resolveTerm(p.text, ctx, lang);
      })
      .join('');

    ctx.sessionMap.set(name, rebuilt, 'code', kind);
    return rebuilt;
  }

  private resolveTerm(term: string, ctx: PipelineContext, lang?: string): string {
    const existing = ctx.sessionMap.getByOriginal(term);
    if (existing) return existing;

    if (isLanguageKeyword(term, lang) || isLanguageKeyword(term.toLowerCase(), lang)) {
      return term;
    }

    // Case-cascade: camelCase `fooRepository` and PascalCase `FooRepository`
    // share a root token `foo`/`Foo`. Keep them bound to the same underlying
    // pseudo by searching the session map for any case variant, then recasing
    // the pseudo to match the caller's casing.
    const variants = caseVariants(term);
    for (const variant of variants) {
      const mapped = ctx.sessionMap.getByOriginal(variant);
      if (mapped) {
        const recased = matchCase(mapped, term);
        // Only register a new entry when the recased pseudo differs from the
        // variant's pseudo. Registering the same pseudo under a new original
        // would blow the BiMap uniqueness invariant. The caller still gets
        // the recased string, which is correct because the full compound
        // (e.g. `AcmeInvoiceService`) gets stored by pseudoFor regardless.
        if (recased !== mapped && recased !== term) {
          ctx.sessionMap.set(term, recased, 'code', 'domain-term');
        }
        return recased;
      }
    }

    const generated = this.gen.identifier(term);
    const pseudo = matchCase(generated, term);
    ctx.sessionMap.set(term, pseudo, 'code', 'domain-term');
    return pseudo;
  }
}

function caseVariants(term: string): string[] {
  if (!term) return [];
  const lower = term.toLowerCase();
  const upper = term.toUpperCase();
  const pascal = term[0].toUpperCase() + term.slice(1).toLowerCase();
  const camel = term[0].toLowerCase() + term.slice(1);
  return [...new Set([lower, upper, pascal, camel])].filter((v) => v !== term);
}

function matchCase(pseudo: string, source: string): string {
  if (!source || !pseudo) return pseudo;
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return pseudo.toUpperCase();
  }
  if (source[0] === source[0].toLowerCase()) {
    return pseudo[0].toLowerCase() + pseudo.slice(1);
  }
  return pseudo[0].toUpperCase() + pseudo.slice(1);
}

function extractCodeFenceSources(text: string): string[] {
  const fences: string[] = [];
  // match ``` followed by optional language tag and newline, capture body
  // until the next ``` on a line. Multiline and non-greedy.
  const re = /```(?:[a-zA-Z0-9_+-]*)?\r?\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1].length > 0) fences.push(m[1]);
  }
  return fences;
}

// Inline-backtick identifiers in chat prompts don't reach the AST because
// there's no fenced code block, but they're still code tokens. Pull them
// out and feed them straight to pseudoFor.
export function extractInlineCodeTokens(text: string): string[] {
  const tokens: string[] = [];
  const tripleRanges: Array<[number, number]> = [];
  const tripleRe = /```(?:[a-zA-Z0-9_+-]*)?\r?\n?[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = tripleRe.exec(text)) !== null) {
    tripleRanges.push([m.index, m.index + m[0].length]);
  }

  const inlineRe = /`([^`\r\n]{2,64})`/g;
  const seen = new Set<string>();
  while ((m = inlineRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (tripleRanges.some(([s, e]) => start >= s && end <= e)) continue;
    const content = m[1].trim();
    // Only treat as identifier-shaped when it looks like one (no spaces, has
    // an alpha character, reasonable charset). Avoids grabbing short quoted
    // strings or commands that happen to sit in backticks.
    if (!/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(content)) continue;
    if (seen.has(content)) continue;
    seen.add(content);
    tokens.push(content);
  }
  return tokens;
}

function findMatchingBrace(text: string, openPos: number): number {
  let depth = 1;
  for (let i = openPos + 1; i < text.length; i++) {
    const ch = text[i];

    // skip string literals
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i, ch);
      continue;
    }

    // skip line comments: if no newline is found, the rest of the input is a
    // line comment - fall through to natural loop exit instead of early return
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }

    // skip block comments: unterminated block comments run to EOF
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) {
        i = text.length;
        continue;
      }
      i = close + 1; // position on '/' of the closing */
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(text: string, start: number, quote: string): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) return i;
    // template literal nested expression
    if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
      const end = findMatchingBrace(text, i + 1);
      if (end === -1) return text.length;
      i = end;
    }
  }
  return text.length;
}
