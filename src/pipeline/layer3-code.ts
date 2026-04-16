import { PseudoGen } from '../pseudo.js';
import {
  extractIdentifiers,
  extractFunctionBodies,
  extractTopLevelValues,
} from '../ast/extractor.js';
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
    let result = text;
    const replacements: Replacement[] = [];

    for (const term of domainTerms) {
      if (!result.includes(term)) continue;

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

    if (ctx.filePath && pathMatchesAny(ctx.filePath, ctx.config.code.redactBodies)) {
      result = await this.redactAllBodiesAsync(result, allReplacements, ctx.config.code.language);
    }

    result = this.handleRedactAnnotations(result, allReplacements);
    result = await this.applyAstIdentifiers(result, allReplacements, ctx);
    result = this.handlePackagePaths(result, allReplacements, ctx);
    result = this.applyCompoundDomainTerms(result, allReplacements, ctx);
    result = this.applyStandaloneDomainTerms(result, allReplacements, ctx);

    return { text: result, replacements: allReplacements };
  }

  private async applyAstIdentifiers(
    text: string,
    out: Replacement[],
    ctx: PipelineContext,
  ): Promise<string> {
    const lang = ctx.config.code.language;
    let result = text;

    try {
      const ids = await extractIdentifiers(result, lang, ctx.config.code.preserve);
      const replMap = new Map<string, string>();

      for (const id of ids) {
        if (replMap.has(id.name)) continue;
        const pseudo = this.pseudoFor(id.name, id.kind, ctx);
        if (pseudo && pseudo !== id.name) {
          replMap.set(id.name, pseudo);
        }
      }

      for (const [orig, pseudo] of ctx.sessionMap.entries()) {
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

  private applyCompoundDomainTerms(text: string, out: Replacement[], ctx: PipelineContext): string {
    let result = text;
    for (const term of ctx.config.code.domainTerms) {
      if (!result.includes(term)) continue;

      const compound = new RegExp(`\\b([a-zA-Z]*${escapeRegex(term)}[a-zA-Z]*)\\b`, 'g');
      const compoundMap = new Map<string, string>();

      let cm: RegExpExecArray | null;
      while ((cm = compound.exec(result)) !== null) {
        const full = cm[1];
        if (compoundMap.has(full)) continue;
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
  ): string {
    let result = text;
    for (const term of ctx.config.code.domainTerms) {
      if (!result.includes(term)) continue;

      const pseudo = this.resolveTerm(term, ctx);
      const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'g');

      let m: RegExpExecArray | null;
      while ((m = re.exec(result)) !== null) {
        out.push({
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
    return result;
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
          return this.resolveTerm(part, ctx);
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

    // find annotation + function, replace entire body
    const linePattern = /\/\/\s*@ainonymity:redact\s*\n([^\n]*?\{)/g;
    let match: RegExpExecArray | null;
    const edits: Array<{ start: number; end: number; replacement: string }> = [];

    while ((match = linePattern.exec(result)) !== null) {
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

  private pseudoFor(name: string, kind: string, ctx: PipelineContext): string | null {
    const existing = ctx.sessionMap.getByOriginal(name);
    if (existing) return existing;

    const parts = splitIdentifier(name);
    const { domainTerms } = ctx.config.code;
    const domainSet = new Set(domainTerms.map((t) => t.toLowerCase()));
    const sensitive =
      ctx.filePath != null && pathMatchesAny(ctx.filePath, ctx.config.code.sensitivePaths);

    const mapped = parts.map((part) => {
      const lower = part.toLowerCase();

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
        return this.resolveTerm(p.text, ctx);
      })
      .join('');

    ctx.sessionMap.set(name, rebuilt, 'code', kind);
    return rebuilt;
  }

  private resolveTerm(term: string, ctx: PipelineContext): string {
    const existing = ctx.sessionMap.getByOriginal(term);
    if (existing) return existing;

    const pseudo = this.gen.identifier(term);
    ctx.sessionMap.set(term, pseudo, 'code', 'domain-term');
    return pseudo;
  }
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
