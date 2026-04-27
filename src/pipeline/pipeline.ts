import type { AInonymousConfig, AnonymizeResult, PipelineContext, Replacement } from '../types.js';
import type { AuditLogger } from '../audit/logger.js';
import { escapeRegex } from '../shared.js';
import { stripFormatChars } from '../patterns/normalize.js';
import { canonicalIPv6, ipv6CandidateRegex } from '../patterns/ipv6.js';
import { broadcastStats, broadcastEntry } from '../audit/dashboard.js';
import { BiMap } from '../session/map.js';
import { PseudoGen } from '../pseudo.js';
import { SecretsLayer } from './layer1-secrets.js';
import { IdentityLayer } from './layer2-identity.js';
import { CodeLayer } from './layer3-code.js';
import { selectFilters, BUILT_IN_OR_FILTERS } from '../patterns/or-filters/index.js';
import { loadCustomFilters } from '../patterns/or-filters/loader.js';
import type { OrPostFilter } from '../patterns/or-filters/types.js';
import { DetectorRegistry } from '../plugin-api/registry.js';
import { assertDetectorPlugin } from '../plugin-api/index.js';
import type { DetectorPlugin } from '../plugin-api/index.js';
import { resolve as resolvePath, isAbsolute } from 'node:path';
import { loadPinnedModuleSource } from '../util/pinned-module.js';
import { log } from '../logger.js';

class DetectorPinMismatchError extends Error {
  constructor(path: string, expected: string, actual: string) {
    super(`detector plugin "${path}" sha256 pin mismatch. Expected ${expected}, got ${actual}.`);
    this.name = 'DetectorPinMismatchError';
  }
}

export class Pipeline {
  private sessionMap: BiMap;
  private pseudoGen = new PseudoGen();
  private secrets = new SecretsLayer();
  private identity: IdentityLayer;
  private code: CodeLayer;
  private config: AInonymousConfig;
  private logger?: AuditLogger;
  private orFilters: readonly OrPostFilter[];
  private detectorRegistry = new DetectorRegistry();
  private disabledDetectorIds: ReadonlySet<string> = new Set();

  constructor(config: AInonymousConfig, logger?: AuditLogger) {
    this.config = config;
    this.logger = logger;
    const persist = config.session?.persist === true;
    const sessionKey = resolveSessionKey();
    if (persist && !sessionKey) {
      throw new Error(
        'session.persist is true but AINONYMOUS_SESSION_KEY is not set (or invalid). ' +
          'Without a stable key the DB becomes unreadable on every restart and entries are silently dropped. ' +
          'Generate one with: openssl rand -base64 32',
      );
    }
    this.sessionMap = new BiMap({
      persist,
      persistPath: config.session?.persistPath,
      key: sessionKey,
    });
    if (persist) this.seedCountersFromStore();
    this.identity = new IdentityLayer(this.pseudoGen);
    this.code = new CodeLayer(this.pseudoGen);
    this.orFilters = selectFilters(
      {
        disable: config.filters?.disable,
        extra: [],
      },
      BUILT_IN_OR_FILTERS,
    );
    this.disabledDetectorIds = new Set(config.detectors?.disable ?? []);
  }

  setOrFilters(filters: readonly OrPostFilter[]): void {
    this.orFilters = filters;
  }

  /** Resolves custom filter paths declared in config.filters.custom, enforces
   *  trust gates, and merges them into the effective chain. Caller must await
   *  before the first anonymize() call to see custom filters take effect. */
  async loadConfiguredCustomFilters(projectDir: string): Promise<void> {
    const custom = this.config.filters?.custom ?? [];
    if (custom.length === 0) return;
    const allow = this.config.trust?.allowUnsignedLocal === true;
    const pins = this.config.filters?.customPins ?? {};
    const loaded = await loadCustomFilters(
      custom.map((p) => ({ path: p, allowUnsignedLocal: allow, sha256: pins[p] })),
      projectDir,
    );
    if (loaded.length === 0) return;
    // Warn when a custom filter id collides with a disabled built-in. An
    // operator disabling `credit-card-preset` and re-using the same id in
    // a local .mjs is expected behaviour, but without the warn-line it looks
    // identical to a silent shadow attack.
    const disabledIds = new Set(this.config.filters?.disable ?? []);
    const builtinIds = new Set(BUILT_IN_OR_FILTERS.map((f) => f.id));
    for (const { filter } of loaded) {
      if (builtinIds.has(filter.id) && disabledIds.has(filter.id)) {
        log.warn('custom filter id shadows a disabled built-in', {
          id: filter.id,
        });
      }
    }
    this.orFilters = selectFilters(
      { disable: this.config.filters?.disable, extra: loaded.map((l) => l.filter) },
      BUILT_IN_OR_FILTERS,
    );
    log.info('custom or-filters loaded', {
      count: loaded.length,
      ids: loaded.map((l) => l.filter.id),
    });
  }

  registerDetectorPlugin(plugin: DetectorPlugin, path?: string): void {
    assertDetectorPlugin(plugin);
    this.detectorRegistry.register(plugin, path);
  }

  /** Loads `.mjs` DetectorPlugin modules declared in
   *  `detectors.custom`. Subject to the same `trust.allow_unsigned_local`
   *  gate as custom or-filters and to optional sha256 pins. Custom detectors
   *  extend Layer 1 and Layer 2 with project-specific matchers without
   *  touching the built-in match tables. */
  async loadConfiguredDetectors(projectDir: string): Promise<void> {
    const custom = this.config.detectors?.custom ?? [];
    if (custom.length === 0) return;
    const allow = this.config.trust?.allowUnsignedLocal === true;
    const pins = this.config.detectors?.customPins ?? {};
    for (const rel of custom) {
      const abs = isAbsolute(rel) ? rel : resolvePath(projectDir, rel);
      if (!allow) {
        throw new Error(
          `refusing to load unsigned local detector "${abs}". ` +
            `Set trust.allow_unsigned_local: true in .ainonymous.yml to opt in.`,
        );
      }
      // Shared helper validates path existence, hex64 pin format and pin
      // match. Reads bytes once and reuses them for the data URL so a TOCTOU
      // swap between hash-check and import is impossible.
      const { dataUrl } = loadPinnedModuleSource(abs, pins[rel], (path, expected, actual) => {
        throw new DetectorPinMismatchError(path, expected, actual);
      });
      const mod = (await import(dataUrl)) as { default?: unknown };
      if (!mod.default) {
        throw new Error(`detector plugin ${abs} has no default export`);
      }
      assertDetectorPlugin(mod.default);
      this.detectorRegistry.register(mod.default, abs);
      log.info('detector plugin registered', { id: mod.default.id, path: abs });
    }
  }

  // Block size chosen empirically: 100k pseudonyms per type per process is
  // ample for a long-running instance while keeping the gap between sibling
  // processes small enough that rotation/archive cycles stay comparable.
  // Every counter that PseudoGen exposes must be seeded here, otherwise
  // sibling processes collide at index 0 for that type.
  private seedCountersFromStore(): void {
    const BLOCK = 100_000;
    const names = [
      'identifier',
      'person',
      'email',
      'domain',
      'ipv4',
      'ipv6',
      'mac',
      'dob',
      'ukNi',
      'taxId',
      'nhs',
      'sv',
      'phone',
      'iban',
      'creditCard',
      'address',
      'personalausweis',
      'ssn',
      'zipUs',
      'passportUs',
      'passportUk',
      'dlUs',
      'dlUk',
      'postcodeUk',
      'sinCa',
      'tfnAu',
      'medicareAu',
      'aadhaar',
      'pan',
      'cpf',
      'cnpj',
      'curp',
      'rfc',
      'rrnKr',
      'idZa',
      'taxIdHu',
      'pidHu',
      'nikId',
    ] as const;
    const batch = this.sessionMap.reserveCounterBlocks(names as unknown as string[], BLOCK);
    if (batch === null) return;
    for (const name of names) {
      const range = batch.get(name);
      if (range !== undefined) this.pseudoGen.seedCounter(name, range.start);
    }
  }

  async anonymize(text: string, filePath?: string): Promise<AnonymizeResult> {
    const ctx: PipelineContext = {
      sessionMap: this.sessionMap,
      config: this.config,
      filePath,
      orFilters: this.orFilters,
      detectorRegistry: this.detectorRegistry,
      disabledDetectorIds: this.disabledDetectorIds,
    };
    const allReplacements: Replacement[] = [];

    // Layer 1: secrets (always first, non-reversible)
    const r1 = await this.secrets.processAsync(text, ctx);
    allReplacements.push(...r1.replacements);

    // Layer 2: identity (enhanced with OpenRedaction patterns)
    const r2 = await this.identity.processAsync(r1.text, ctx);
    allReplacements.push(...r2.replacements);

    // Layer 3: code semantics (async because of AST)
    const r3 = await this.code.processAsync(r2.text, ctx);
    allReplacements.push(...r3.replacements);

    if (this.logger && allReplacements.length > 0) {
      this.logger.logBatch(allReplacements);
      broadcastStats(this.logger.stats());
      for (const r of allReplacements) {
        broadcastEntry({
          layer: r.layer,
          type: r.type,
          pseudonym: r.pseudonym,
          timestamp: Date.now(),
        });
      }
    }

    return { text: r3.text, replacements: allReplacements };
  }

  rehydrate(text: string, opts?: { allowedPseudonyms?: Set<string> }): string {
    // Oracle-attack defense: when the caller knows which pseudonyms it sent,
    // rehydrate only those. Blocks a malicious upstream from probing the
    // session map by echoing arbitrary pseudos in its response.
    const allowed = opts?.allowedPseudonyms;
    // Drop zero-width format chars before the match loop so a pseudonym split
    // by ZWJ/ZWNJ/CGJ still lines up with the session map. The response loses
    // those invisibles; upstream responses do not carry visible content there.
    text = stripFormatChars(text);
    const entries = [...this.sessionMap.entries()]
      .filter(([, pseudo]) => pseudo !== '***REDACTED***')
      .filter(([, pseudo]) => !allowed || allowed.has(pseudo))
      .sort((a, b) => b[1].length - a[1].length);

    if (entries.length === 0) return text;

    // "Pure" originals are those never assigned as a pseudonym elsewhere.
    // Their occurrences must be protected from accidental replacement when a
    // pseudonym appears as a substring (e.g. original "AlphaLambda" contains
    // pseudonym "Lambda"). Chain-middle originals stay unprotected so cascades
    // keep working.
    const pseudonymSet = new Set(entries.map(([, p]) => p));
    const pureOriginals = entries.map(([orig]) => orig).filter((orig) => !pseudonymSet.has(orig));

    const ipv6CanonPseudo = new Map<string, string>();
    for (const [original, pseudonym] of entries) {
      const c = canonicalIPv6(pseudonym);
      if (c !== undefined) ipv6CanonPseudo.set(c, original);
    }

    let result = text;
    let changed = true;
    let iterations = 0;
    const MAX_ITER = 10;
    const rehydrated = new Set<string>();

    while (changed && iterations < MAX_ITER) {
      iterations++;
      changed = false;

      if (iterations === MAX_ITER) {
        log.warn('rehydration hit iteration cap', { max: MAX_ITER, entries: entries.length });
      }

      const protectedRanges = findRanges(result, pureOriginals);

      type Hit = { start: number; end: number; replacement: string };
      const hits: Hit[] = [];

      if (ipv6CanonPseudo.size > 0) {
        const re = ipv6CandidateRegex();
        let cm: RegExpExecArray | null;
        while ((cm = re.exec(result)) !== null) {
          const canon = canonicalIPv6(cm[0]);
          if (canon === undefined) continue;
          const original = ipv6CanonPseudo.get(canon);
          if (original === undefined) continue;
          const start = cm.index;
          const end = start + cm[0].length;
          if (isInsideAny(start, end, protectedRanges)) continue;
          if (result.substring(start, end) === ipv6CanonPseudo.get(canon)) continue;
          hits.push({ start, end, replacement: original });
        }
      }

      for (const [original, pseudonym] of entries) {
        if (!result.includes(pseudonym)) continue;
        const escaped = escapeRegex(pseudonym);
        // Short pseudos like Eta/Rho must not rewrite words that contain them
        // (Theta, Rhombus). Word boundary on the left, lowercase-lookahead
        // on the right still lets PascalCase compounds rehydrate.
        const startsAlphaNum = /^[A-Za-z0-9_]/.test(pseudonym);
        const endsAlphaNum = /[A-Za-z0-9]$/.test(pseudonym);
        const leftBoundary = startsAlphaNum ? '\\b' : '';
        const rightBoundary = endsAlphaNum ? '(?![a-z0-9])' : '';
        const boundedPattern = leftBoundary + escaped + rightBoundary;
        const re = new RegExp(boundedPattern, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(result)) !== null) {
          const start = m.index;
          const end = start + pseudonym.length;
          if (isInsideAny(start, end, protectedRanges)) continue;
          hits.push({ start, end, replacement: original });
        }
      }

      if (hits.length === 0) break;

      hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
      const kept: Hit[] = [];
      for (const h of hits) {
        const prev = kept[kept.length - 1];
        if (prev && h.start < prev.end) continue;
        kept.push(h);
      }

      for (let i = kept.length - 1; i >= 0; i--) {
        const h = kept[i];
        result = result.slice(0, h.start) + h.replacement + result.slice(h.end);
        rehydrated.add(h.replacement);
      }

      changed = kept.length > 0;
    }

    if (this.logger && rehydrated.size > 0) {
      const pseudoByOrig = new Map(entries);
      const records = [...rehydrated].map((orig) => {
        const meta = this.sessionMap.getMeta(orig);
        return {
          original: orig,
          pseudonym: pseudoByOrig.get(orig) ?? '',
          layer: meta?.layer ?? ('code' as const),
          type: meta?.type ?? 'pseudonym',
        };
      });
      this.logger.logRehydration(records);
    }

    return result;
  }

  getSessionMap(): BiMap {
    return this.sessionMap;
  }

  getPseudoGen(): PseudoGen {
    return this.pseudoGen;
  }

  reset(): void {
    this.sessionMap.clear();
  }

  close(): void {
    this.sessionMap.close();
  }
}

function resolveSessionKey(): Buffer | undefined {
  const raw = process.env['AINONYMOUS_SESSION_KEY'];
  if (!raw) return undefined;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      log.warn('AINONYMOUS_SESSION_KEY has wrong length, ignoring', { length: buf.length });
      return undefined;
    }
    return buf;
  } catch (err) {
    log.warn('AINONYMOUS_SESSION_KEY could not be parsed, ignoring', {
      reason: (err as Error).message,
    });
    return undefined;
  }
}

function findRanges(text: string, needles: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const needle of needles) {
    if (!needle || !text.includes(needle)) continue;
    const escaped = escapeRegex(needle);
    const re = new RegExp(escaped, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      ranges.push([m.index, m.index + needle.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function isInsideAny(start: number, end: number, ranges: Array<[number, number]>): boolean {
  if (ranges.length === 0) return false;
  // ranges are sorted by start (from findRanges). Binary search for the largest
  // range whose start is <= query.start - that is the only candidate because
  // ranges are also non-overlapping (merged).
  let lo = 0;
  let hi = ranges.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid][0] <= start) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) return false;
  return end <= ranges[candidate][1];
}
