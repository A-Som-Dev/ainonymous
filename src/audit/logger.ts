import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  writeFileSync,
  appendFileSync,
  mkdirSync,
  statSync,
  existsSync,
  unlinkSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import type { AuditEntry, Replacement, AuditLayer } from '../types.js';
import { isSentinel } from '../session/map.js';
import { atomicWriteFileSync } from './atomic.js';
import { getBootId } from './boot-id.js';

const CHECKPOINT_HEX64_RE = /^[0-9a-f]{64}$/;

export function parseCheckpoint(raw: string): { lastSeq: number; lastHash: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const lastSeq = obj.lastSeq;
  const lastHash = obj.lastHash;
  if (typeof lastSeq !== 'number' || !Number.isInteger(lastSeq) || lastSeq < 0) return null;
  if (typeof lastHash !== 'string' || !CHECKPOINT_HEX64_RE.test(lastHash)) return null;
  return { lastSeq, lastHash };
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function hashTruncated(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function chainHash(prev: string, entry: Omit<AuditEntry, 'prevHash'>): string {
  const serialized = JSON.stringify(entry);
  return createHash('sha256').update(prev).update(serialized).digest('hex');
}

// Resolves AINONYMOUS_AUDIT_HMAC_KEY (base64, >=32 bytes) or returns null.
export function resolveAuditHmacKey(): Buffer | null {
  const raw = process.env['AINONYMOUS_AUDIT_HMAC_KEY'];
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length < 32) return null;
    return buf;
  } catch {
    return null;
  }
}

export const DEFAULT_HMAC_KID = 'default';
const HMAC_KEYRING_PREFIX = 'AINONYMOUS_AUDIT_HMAC_KEY_';
const HMAC_ACTIVE_KID_ENV = 'AINONYMOUS_AUDIT_HMAC_ACTIVE_KID';

export type HmacKeyring = Map<string, Buffer>;

// Collects every configured HMAC key into a keyring:
//   AINONYMOUS_AUDIT_HMAC_KEY      -> kid "default"
//   AINONYMOUS_AUDIT_HMAC_KEY_<X>  -> kid lowercase(x)
// Returns null if no usable key is configured. Throws on ambiguous setups
// so an operator cannot silently pick the wrong key through env clash.
export function resolveAuditHmacKeyring(): HmacKeyring | null {
  const ring: HmacKeyring = new Map();
  const legacy = resolveAuditHmacKey();
  if (legacy !== null) ring.set(DEFAULT_HMAC_KID, legacy);
  for (const [envName, raw] of Object.entries(process.env)) {
    if (!raw || !envName.startsWith(HMAC_KEYRING_PREFIX)) continue;
    const kid = envName.slice(HMAC_KEYRING_PREFIX.length).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(kid)) continue;
    try {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length < 32) continue;
      if (ring.has(kid)) {
        throw new Error(
          `audit hmac keyring: conflicting keys resolve to kid "${kid}". ` +
            `Remove either AINONYMOUS_AUDIT_HMAC_KEY (legacy "default") or ${envName}.`,
        );
      }
      ring.set(kid, buf);
    } catch (err) {
      if (err instanceof Error && err.message.includes('conflicting keys')) throw err;
      /* skip malformed */
    }
  }
  return ring.size === 0 ? null : ring;
}

export function resolveActiveHmacKid(ring: HmacKeyring): string {
  const explicit = process.env[HMAC_ACTIVE_KID_ENV]?.trim().toLowerCase();
  if (explicit && ring.has(explicit)) return explicit;
  if (ring.has(DEFAULT_HMAC_KID)) return DEFAULT_HMAC_KID;
  // Deterministic fallback to keep sidecars reproducible across restarts.
  return [...ring.keys()].sort()[0];
}

export function hmacLine(key: Buffer, line: string): string {
  return createHmac('sha256', key).update(line).digest('hex');
}

/** Bind the checkpoint MAC to (blob, seq, file basename) so an attacker cannot
 *  replay an older checkpoint+sidecar pair from the same file or copy a pair
 *  from a sibling jsonl. v=1 sidecars (legacy, blob-only MAC) are still
 *  accepted at read time with a warning to keep upgrades smooth, but every
 *  newly written sidecar uses v=2. */
const CHECKPOINT_MAC_VERSION = 2;

function checkpointMacBodyV2(blob: string, seq: number, file: string): string {
  return JSON.stringify({ v: CHECKPOINT_MAC_VERSION, ckpt: blob, seq, file });
}

/** Result of probing a jsonl audit file for its tail sequence number.
 *  Corrupt is tamper-evidence: a generic null would silently skip the
 *  replay-check. */
type TailSeqProbe =
  | { state: 'empty' }
  | { state: 'ok'; seq: number }
  | { state: 'corrupt'; reason: string };

/** Read just enough trailing bytes to recover the last newline-terminated
 *  line. Doubles the window up to 1 MiB so the reader stays bounded even on
 *  a 10 MiB file that contains a single pathological line. */
function readJsonlTail(filepath: string): { line: string | null; truncated: boolean } | null {
  let fd: number | null = null;
  try {
    const size = statSync(filepath).size;
    if (size === 0) return { line: null, truncated: false };
    fd = openSync(filepath, 'r');
    let chunk = 8 * 1024;
    const cap = 1024 * 1024;
    while (true) {
      const win = Math.min(chunk, size);
      const buf = Buffer.alloc(win);
      readSync(fd, buf, 0, win, size - win);
      const txt = buf.toString('utf-8').replace(/\n+$/, '');
      if (txt.length === 0) return { line: null, truncated: false };
      const idx = txt.lastIndexOf('\n');
      if (idx >= 0) return { line: txt.slice(idx + 1), truncated: false };
      if (win >= size) return { line: txt, truncated: false };
      if (chunk >= cap) return { line: txt, truncated: true };
      chunk *= 4;
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** External watermark - lives outside the audit directory so that a one-shot
 *  attacker who can rewrite jsonl + checkpoint + checkpoint.hmac atomically
 *  still cannot make the chain look fresh: the watermark records the highest
 *  seq the logger has ever persisted, and seedFromCheckpoint refuses any
 *  checkpoint whose lastSeq is behind that.
 *
 *  Threat model caveat: this assumes the user-home filesystem has a different
 *  ACL boundary than the audit directory. In single-user environments where
 *  one principal can write both, the watermark is defense-in-depth, not a
 *  hard barrier. SECURITY.md / THREAT_MODEL.md document this explicitly. */
const WATERMARK_DIRNAME = 'audit-state';
const STATE_HOME_OVERRIDE_ENV = 'AINONYMOUS_STATE_HOME';
const STATE_DISABLE_ENV = 'AINONYMOUS_AUDIT_NO_WATERMARK';

const WATERMARK_VERSION = 2;
// Legacy v=1 watermarks remain readable so a pre-cleanup-sweep instance can
// boot, but the writer always emits v=2. The cross-boot binding only kicks
// in once the watermark has been rewritten under v=2.
const WATERMARK_VERSION_LEGACY = 1;

interface AuditWatermark {
  v: number;
  audit_dir: string;
  max_seq: number;
  last_hash: string;
  /** Linux boot witness folded into the v=2 mac body. Cross-boot copies
   *  break MAC verification under HMAC mode. */
  boot_id?: string;
  kid?: string;
  mac?: string;
}

type WatermarkProbe =
  | { state: 'absent' }
  | { state: 'corrupt'; reason: string }
  | { state: 'ok'; wm: AuditWatermark };

function stateHomeRoot(): string {
  const override = process.env[STATE_HOME_OVERRIDE_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), '.ainonymous');
}

export function getWatermarkPath(auditDir: string): string {
  const abs = resolvePath(auditDir);
  const tag = createHash('sha256').update(abs).digest('hex').slice(0, 32);
  return join(stateHomeRoot(), WATERMARK_DIRNAME, `${tag}.json`);
}

function watermarkMacBody(
  wm: Pick<AuditWatermark, 'audit_dir' | 'max_seq' | 'last_hash' | 'boot_id'>,
): string {
  // Field order is HMAC input. Drop boot_id when undefined so platforms
  // without a source produce identical bodies.
  const body: Record<string, unknown> = {
    v: WATERMARK_VERSION,
    audit_dir: wm.audit_dir,
    max_seq: wm.max_seq,
    last_hash: wm.last_hash,
  };
  if (wm.boot_id !== undefined) body.boot_id = wm.boot_id;
  return JSON.stringify(body);
}

function watermarkMacBodyLegacy(
  wm: Pick<AuditWatermark, 'audit_dir' | 'max_seq' | 'last_hash'>,
): string {
  return JSON.stringify({
    v: WATERMARK_VERSION_LEGACY,
    audit_dir: wm.audit_dir,
    max_seq: wm.max_seq,
    last_hash: wm.last_hash,
  });
}

function probeWatermark(path: string): WatermarkProbe {
  if (!existsSync(path)) return { state: 'absent' };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    return { state: 'corrupt', reason: `read: ${(err as Error).message}` };
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    return { state: 'corrupt', reason: `parse: ${(err as Error).message}` };
  }
  if (
    typeof obj.audit_dir !== 'string' ||
    typeof obj.max_seq !== 'number' ||
    !Number.isInteger(obj.max_seq) ||
    typeof obj.last_hash !== 'string'
  ) {
    return { state: 'corrupt', reason: 'shape mismatch' };
  }
  return {
    state: 'ok',
    wm: {
      v: typeof obj.v === 'number' ? obj.v : 0,
      audit_dir: obj.audit_dir,
      max_seq: obj.max_seq,
      last_hash: obj.last_hash,
      boot_id: typeof obj.boot_id === 'string' ? obj.boot_id : undefined,
      kid: typeof obj.kid === 'string' ? obj.kid : undefined,
      mac: typeof obj.mac === 'string' ? obj.mac : undefined,
    },
  };
}

let watermarkSkipNoticeEmitted = false;

/** Test hook: reset the once-flag for the NO_WATERMARK skip notice. */
export function resetWatermarkSkipNoticeForTests(): void {
  watermarkSkipNoticeEmitted = false;
}

function writeWatermark(
  path: string,
  bodyIn: Pick<AuditWatermark, 'audit_dir' | 'max_seq' | 'last_hash'>,
  keyring: HmacKeyring | null,
  activeKid: string | null,
  failureMode: AuditFailureMode,
): void {
  const boot_id = getBootId() ?? undefined;
  const body: Pick<AuditWatermark, 'audit_dir' | 'max_seq' | 'last_hash' | 'boot_id'> = {
    ...bodyIn,
    boot_id,
  };
  if (process.env[STATE_DISABLE_ENV] === '1') {
    if (!watermarkSkipNoticeEmitted) {
      watermarkSkipNoticeEmitted = true;
      console.error(
        `NOTICE: AINONYMOUS_AUDIT_NO_WATERMARK=1 is set; skipping external watermark writes. ` +
          `A subsequent restart without this env will refuse to seed the chain (because the read-side ` +
          `verification is unconditional and will see the watermark as missing).`,
      );
    }
    return;
  }
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    const wm: AuditWatermark = { v: WATERMARK_VERSION, ...body };
    if (keyring !== null && activeKid !== null) {
      const key = keyring.get(activeKid);
      if (key !== undefined) {
        wm.kid = activeKid;
        wm.mac = hmacLine(key, watermarkMacBody(body));
      }
    }
    if (wm.boot_id === undefined) delete wm.boot_id;
    atomicWriteFileSync(path, JSON.stringify(wm));
  } catch (err) {
    if (failureMode === 'block') {
      throw new AuditPersistError(
        `audit watermark persist failed: ${(err as Error).message}`,
        err,
      );
    }
    console.error(
      `WARNING: audit watermark write failed at ${path}: ${(err as Error).message} - request continuing under auditFailure=permit`,
    );
  }
}

function readJsonlTailSeq(filepath: string): TailSeqProbe {
  const tail = readJsonlTail(filepath);
  if (tail === null) return { state: 'corrupt', reason: 'unreadable' };
  if (tail.line === null) return { state: 'empty' };
  if (tail.truncated) {
    return { state: 'corrupt', reason: 'tail line exceeds bounded window' };
  }
  let parsed: { seq?: unknown };
  try {
    parsed = JSON.parse(tail.line) as { seq?: unknown };
  } catch (err) {
    return { state: 'corrupt', reason: `tail json: ${(err as Error).message}` };
  }
  if (typeof parsed.seq !== 'number' || !Number.isInteger(parsed.seq) || parsed.seq < 0) {
    return { state: 'corrupt', reason: 'tail line missing valid seq' };
  }
  return { state: 'ok', seq: parsed.seq };
}

export type AuditFailureMode = 'block' | 'permit';

export class AuditPersistError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuditPersistError';
  }
}

export class AuditLogger {
  private records: AuditEntry[] = [];
  private persistDir: string | null = null;
  private seq = 0;
  private lastHash = '';
  private failureMode: AuditFailureMode = 'permit';
  private hmacKeyring: HmacKeyring | null = resolveAuditHmacKeyring();
  private activeHmacKid: string | null = this.hmacKeyring
    ? resolveActiveHmacKid(this.hmacKeyring)
    : null;
  private sighupHandler: (() => void) | null = null;

  log(r: Replacement): void {
    // Pseudonyms stay out of persisted records (THREAT_MODEL: GDPR Art. 4(5)).
    const base: Omit<AuditEntry, 'prevHash'> = {
      timestamp: Date.now(),
      layer: r.layer,
      type: r.type,
      originalHash: hashTruncated(r.original),
      context: `${r.type}@${r.offset}:${r.length}`,
      seq: this.seq++,
      ...(isSentinel(r.pseudonym) ? { sentinel: true as const } : {}),
    };
    const entry: AuditEntry = { ...base, prevHash: this.lastHash };
    this.lastHash = chainHash(this.lastHash, base);
    this.records.push(entry);
    this.persistEntry(entry);
  }

  logBatch(replacements: Replacement[]): void {
    for (const r of replacements) this.log(r);
  }

  /** Record which pseudonyms the rehydrator actually swapped back into the
   *  response. `audit pending` diffs anonymize-originals against these to show
   *  session-map entries the LLM never referenced. */
  logRehydration(
    entries: Array<Pick<Replacement, 'original' | 'pseudonym' | 'layer' | 'type'>>,
  ): void {
    for (const e of entries) {
      const base: Omit<AuditEntry, 'prevHash'> = {
        timestamp: Date.now(),
        layer: 'rehydration',
        type: e.type,
        originalHash: hashTruncated(e.original),
        context: `rehydrated:${e.layer}/${e.type}`,
        seq: this.seq++,
      };
      const entry: AuditEntry = { ...base, prevHash: this.lastHash };
      this.lastHash = chainHash(this.lastHash, base);
      this.records.push(entry);
      this.persistEntry(entry);
    }
  }

  entries(): AuditEntry[] {
    return [...this.records];
  }

  stats(): {
    secrets: number;
    identity: number;
    code: number;
    rehydrated: number;
    total: number;
  } {
    let secrets = 0;
    let identity = 0;
    let code = 0;
    let rehydrated = 0;
    for (const entry of this.records) {
      if (entry.layer === 'secrets') secrets++;
      else if (entry.layer === 'identity') identity++;
      else if (entry.layer === 'code') code++;
      else if (entry.layer === 'rehydration') rehydrated++;
    }
    return { secrets, identity, code, rehydrated, total: this.records.length };
  }

  clear(): void {
    this.records = [];
    this.seq = 0;
    this.lastHash = '';
  }

  export(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this.records, null, 2), 'utf-8');
  }

  enablePersistence(dir: string, failureMode: AuditFailureMode = 'permit'): void {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const probe = join(dir, `.ainonymous-probe-${randomBytes(6).toString('hex')}`);
      writeFileSync(probe, '', 'utf-8');
      unlinkSync(probe);
    } catch (err) {
      const msg = `audit probe-write failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`;
      if (failureMode === 'block') {
        throw new AuditPersistError(msg, err);
      }
      console.error(`WARNING: ${msg} - proxy started under auditFailure=permit`);
    }
    this.persistDir = dir;
    this.failureMode = failureMode;
    this.seedFromCheckpoint();
    this.installSighupHandler();
  }

  /**
   * Re-read AINONYMOUS_AUDIT_HMAC_KEY* env vars. Used by the SIGHUP handler
   * and by tests that rotate env keys at runtime. Writes done after this
   * call use whichever kid is currently pointed at by
   * AINONYMOUS_AUDIT_HMAC_ACTIVE_KID (or the new default).
   */
  refreshHmacKeyring(): void {
    let next: HmacKeyring | null = null;
    try {
      next = resolveAuditHmacKeyring();
    } catch (err) {
      // Keep the previous keyring intact so a rotation typo cannot break the
      // running logger. Operator sees the error in stderr and can retry.
      console.error(
        `WARNING: audit hmac keyring refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    const wasEnabled = this.hmacKeyring !== null;
    this.hmacKeyring = next;
    this.activeHmacKid = next ? resolveActiveHmacKid(next) : null;
    if (wasEnabled && next === null) {
      console.error(
        'WARNING: audit hmac keyring refresh resolved to empty; HMAC signing is now disabled. Export at least one AINONYMOUS_AUDIT_HMAC_KEY* before the next rotation.',
      );
    }
  }

  private installSighupHandler(): void {
    if (this.sighupHandler !== null) return;
    if (process.platform === 'win32') return;
    const handler = (): void => {
      this.refreshHmacKeyring();
    };
    this.sighupHandler = handler;
    try {
      process.on('SIGHUP', handler);
    } catch {
      this.sighupHandler = null;
    }
  }

  /** Call during clean shutdown so the long-lived process.on listener
   *  does not accumulate if the logger is rebuilt at runtime. */
  detachSighupHandler(): void {
    if (this.sighupHandler === null) return;
    try {
      process.removeListener('SIGHUP', this.sighupHandler);
    } catch {
      /* ignore */
    }
    this.sighupHandler = null;
  }

  /**
   * Resume the chain state (seq, lastHash) from the on-disk checkpoint so a
   * proxy restart within the same day keeps one continuous chain. Without
   * this, every restart wrote a new seq=0 / prevHash='' entry into the
   * existing file, which verifyAuditChain was forced to treat as a legitimate
   * session boundary and which an attacker could forge.
   */
  private seedFromCheckpoint(): void {
    if (!this.persistDir) return;
    try {
      const filepath = this.currentFile();
      if (!existsSync(filepath)) return;
      const ckptPath = filepath + '.checkpoint';
      if (!existsSync(ckptPath)) return;
      const raw = readFileSync(ckptPath, 'utf-8');
      const parsed = parseCheckpoint(raw);
      if (parsed === null) return;

      // Replay defense that also works without HMAC: probe the jsonl tail and
      // compare against the checkpoint's claimed lastSeq.
      // - `corrupt` is tamper-evidence: refuse to seed.
      // - `empty` jsonl with a checkpoint claiming lastSeq>0 is a state
      //   mismatch: refuse rather than write seq=lastSeq+1 into an empty file.
      // - `ok` with parsed.lastSeq < tail is the classic same-file rollback.
      const tail = readJsonlTailSeq(filepath);
      if (tail.state === 'corrupt') {
        console.error(
          `WARNING: audit jsonl tail unparseable (${tail.reason}); refusing to seed chain (treated as tamper-evidence).`,
        );
        return;
      }
      if (tail.state === 'empty') {
        // First-boot path returned earlier; reaching here means the jsonl
        // got truncated underneath a live checkpoint - tamper.
        console.error(
          `WARNING: audit jsonl is empty but a checkpoint is present (lastSeq=${parsed.lastSeq}); refusing to seed chain (state mismatch).`,
        );
        return;
      }
      if (tail.state === 'ok' && parsed.lastSeq < tail.seq) {
        console.error(
          `WARNING: audit checkpoint lastSeq=${parsed.lastSeq} is behind jsonl tail seq=${tail.seq}; refusing to seed chain (stale or replayed checkpoint).`,
        );
        return;
      }

      const fileName = basename(filepath);

      if (this.hmacKeyring === null) {
        // Keyless: tail-seq and watermark.max_seq still gate, but the
        // watermark itself is unsigned. Flag both gaps once at seed-time.
        console.error(
          `NOTICE: audit persistence resumed without AINONYMOUS_AUDIT_HMAC_KEY; checkpoint and external watermark are advisory only (no cross-file replay defence, watermark itself is unsigned). Configure the HMAC key for full replay defence.`,
        );
      } else {
        const sigPath = ckptPath + '.hmac';
        if (!existsSync(sigPath)) {
          console.error(
            `WARNING: audit checkpoint missing signature at ${sigPath}; refusing to seed chain and starting fresh.`,
          );
          return;
        }
        try {
          const sig = JSON.parse(readFileSync(sigPath, 'utf-8')) as {
            v?: unknown;
            kid?: unknown;
            mac?: unknown;
          };
          if (typeof sig.kid !== 'string' || typeof sig.mac !== 'string') {
            throw new Error('checkpoint signature shape');
          }
          const key = this.hmacKeyring.get(sig.kid);
          if (key === undefined) {
            console.error(
              `WARNING: audit checkpoint signed under unknown kid "${sig.kid}"; refusing to seed chain.`,
            );
            return;
          }
          const sigVersion = typeof sig.v === 'number' ? sig.v : 1;
          if (sigVersion !== CHECKPOINT_MAC_VERSION) {
            // v=1 sidecars only sign the blob without seq/file binding and
            // open a cross-file replay path. No release ever wrote v=1, so
            // refusing here just starts a fresh chain at seq=0.
            console.error(
              `WARNING: audit checkpoint signature version ${String(sigVersion)} is not supported (require v${CHECKPOINT_MAC_VERSION}); refusing to seed chain.`,
            );
            return;
          }
          const expected = hmacLine(key, checkpointMacBodyV2(raw, parsed.lastSeq, fileName));
          if (expected !== sig.mac) {
            console.error(
              `WARNING: audit checkpoint signature mismatch (v${CHECKPOINT_MAC_VERSION} bound to seq+file); refusing to seed chain.`,
            );
            return;
          }
        } catch {
          console.error(
            `WARNING: audit checkpoint signature unreadable; refusing to seed chain.`,
          );
          return;
        }
      }
      // Read-side watermark gate, unconditional. STATE_DISABLE_ENV only
      // affects writes; gating reads on the same env would let a single flag
      // silently disable the rollback defense.
      const wmPath = getWatermarkPath(this.persistDir);
      const wmProbe = probeWatermark(wmPath);
      if (wmProbe.state === 'corrupt') {
        console.error(
          `WARNING: audit watermark at ${wmPath} is corrupt (${wmProbe.reason}); refusing to seed chain (treated as tamper-evidence).`,
        );
        return;
      }
      if (wmProbe.state === 'absent') {
        // Reached only with a checkpoint already present. Three callers
        // produce this state: deletion attack, pre-watermark upgrade, manual
        // rollback. All three: refuse and let the operator decide (rm audit
        // dir for fresh start, or restore watermark from backup). No
        // lastSeq>0 shortcut: a forged {lastSeq:0,...} would otherwise
        // round-trip a truncated jsonl back into a clean chain.
        console.error(
          `WARNING: audit checkpoint exists at ${ckptPath} but the external watermark at ${wmPath} is missing; refusing to seed chain. If this is a clean upgrade from a pre-1.3.0 build, remove the audit directory and restart to start a fresh chain.`,
        );
        return;
      }
      if (wmProbe.state === 'ok') {
        const wm = wmProbe.wm;
        if (wm.v !== WATERMARK_VERSION && wm.v !== WATERMARK_VERSION_LEGACY) {
          console.error(
            `WARNING: audit watermark schema version ${wm.v} is not supported (accept v${WATERMARK_VERSION_LEGACY} legacy or v${WATERMARK_VERSION}); refusing to seed chain.`,
          );
          return;
        }
        if (wm.v === WATERMARK_VERSION_LEGACY) {
          console.error(
            `NOTICE: audit watermark is on legacy v=${WATERMARK_VERSION_LEGACY}; cross-boot binding activates after the next persistEntry rewrites it as v=${WATERMARK_VERSION}.`,
          );
        }
        if (wm.audit_dir !== resolvePath(this.persistDir)) {
          console.error(
            `WARNING: audit watermark belongs to a different audit_dir (${wm.audit_dir}); refusing to seed chain.`,
          );
          return;
        }
        if (this.hmacKeyring !== null) {
          if (typeof wm.kid !== 'string' || typeof wm.mac !== 'string') {
            console.error(
              `WARNING: audit watermark missing signature while HMAC is configured; refusing to seed chain.`,
            );
            return;
          }
          const wkey = this.hmacKeyring.get(wm.kid);
          if (wkey === undefined) {
            console.error(
              `WARNING: audit watermark signed under unknown kid "${wm.kid}"; refusing to seed chain.`,
            );
            return;
          }
          const macBody = wm.v === WATERMARK_VERSION_LEGACY
            ? watermarkMacBodyLegacy({
                audit_dir: wm.audit_dir,
                max_seq: wm.max_seq,
                last_hash: wm.last_hash,
              })
            : watermarkMacBody({
                audit_dir: wm.audit_dir,
                max_seq: wm.max_seq,
                last_hash: wm.last_hash,
                boot_id: wm.boot_id,
              });
          const expected = hmacLine(wkey, macBody);
          if (expected !== wm.mac) {
            console.error(
              `WARNING: audit watermark signature mismatch; refusing to seed chain.`,
            );
            return;
          }
        } else if (wm.boot_id !== undefined) {
          // Keyless: no MAC to enforce binding, just surface divergence.
          const current = getBootId();
          if (current !== null && current !== wm.boot_id) {
            console.error(
              `NOTICE: audit watermark boot_id (${wm.boot_id}) differs from current boot session (${current}); seeding anyway because keyless mode has no MAC to bind it. Configure AINONYMOUS_AUDIT_HMAC_KEY for full cross-boot replay defence.`,
            );
          }
        }
        if (parsed.lastSeq < wm.max_seq) {
          console.error(
            `WARNING: audit checkpoint lastSeq=${parsed.lastSeq} is behind external watermark max_seq=${wm.max_seq}; refusing to seed chain (atomic rollback suspected).`,
          );
          return;
        }
      }

      this.seq = parsed.lastSeq + 1;
      this.lastHash = parsed.lastHash;
    } catch {
      /* best-effort seed; stay at seq=0 if the checkpoint is unreadable */
    }
  }

  query(opts: { from?: number; to?: number; layer?: AuditLayer; type?: string }): AuditEntry[] {
    return this.records.filter((e) => {
      if (opts.from !== undefined && e.timestamp < opts.from) return false;
      if (opts.to !== undefined && e.timestamp > opts.to) return false;
      if (opts.layer !== undefined && e.layer !== opts.layer) return false;
      if (opts.type !== undefined && e.type !== opts.type) return false;
      return true;
    });
  }

  private persistEntry(entry: AuditEntry): void {
    if (!this.persistDir) return;
    // Snapshot HMAC state up-front so the JSONL line, its `.hmac` sidecar
    // and the `.checkpoint` sidecar all reflect the same kid. A SIGHUP
    // landing between appends would otherwise tag each artifact under a
    // different kid and leave the chain unverifiable at the rotation
    // boundary.
    const keyring = this.hmacKeyring;
    const activeKid = this.activeHmacKid;
    if (typeof entry.seq !== 'number') {
      throw new Error('persistEntry called with seq-less entry - log() must assign seq before persist');
    }
    const seq = entry.seq;
    try {
      const filepath = this.currentFile();
      const line = JSON.stringify(entry);
      appendFileSync(filepath, line + '\n', 'utf-8');
      const ckptPath = filepath + '.checkpoint';
      const ckpt = JSON.stringify({ lastSeq: seq, lastHash: this.lastHash });
      atomicWriteFileSync(ckptPath, ckpt);
      writeWatermark(
        getWatermarkPath(this.persistDir),
        {
          audit_dir: resolvePath(this.persistDir),
          max_seq: seq,
          last_hash: this.lastHash,
        },
        keyring,
        activeKid,
        this.failureMode,
      );
      if (keyring !== null && activeKid !== null) {
        const key = keyring.get(activeKid);
        if (key !== undefined) {
          const mac = hmacLine(key, line);
          appendFileSync(
            filepath + '.hmac',
            JSON.stringify({ seq, kid: activeKid, mac }) + '\n',
            'utf-8',
          );
          // Sign the checkpoint under the same kid AND bind the MAC to seq
          // and file basename. Without that binding, an attacker with write
          // access could swap a (.checkpoint, .checkpoint.hmac) pair with an
          // older snapshot from the same file or a sibling file - the blob
          // would still self-verify under v1.
          const macBody = checkpointMacBodyV2(ckpt, seq, basename(filepath));
          const ckptMac = hmacLine(key, macBody);
          atomicWriteFileSync(
            ckptPath + '.hmac',
            JSON.stringify({ v: CHECKPOINT_MAC_VERSION, kid: activeKid, mac: ckptMac }),
          );
        }
      }
    } catch (err) {
      if (this.failureMode === 'block') {
        throw new AuditPersistError(
          `audit persist failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
      console.error(
        `WARNING: audit persist failed (${err instanceof Error ? err.message : String(err)}) - request continuing under auditFailure=permit`,
      );
    }
  }

  private currentFile(): string {
    if (!this.persistDir) throw new Error('persistence not enabled');
    const base = `ainonymous-audit-${todayStamp()}`;
    let part = 0;
    while (true) {
      const suffix = part === 0 ? '' : `.part${part}`;
      const path = join(this.persistDir, `${base}${suffix}.jsonl`);
      if (!existsSync(path)) return path;
      const size = statSync(path).size;
      if (size < MAX_FILE_BYTES) return path;
      part++;
    }
  }
}

/**
 * Verify a JSONL audit file's hash chain. Returns the first bad sequence
 * number or null if the chain is intact. A session boundary (seq === 0 with
 * empty prevHash) after a prior session is treated as a valid restart, not
 * tampering - AuditLogger resets its state on clear() and on new-instance.
 */
export function verifyAuditChain(
  lines: string[],
  expected?: { lastSeq: number; lastHash: string } | 'required',
): number | null {
  let prev = '';
  let expectedSeq = 0;
  let actualLastSeq = -1;
  let actualLastHash = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: AuditEntry;
    try {
      entry = JSON.parse(line) as AuditEntry;
    } catch {
      return expectedSeq;
    }
    if (entry.seq === 0 && entry.prevHash === '' && expectedSeq !== 0) {
      prev = '';
      expectedSeq = 0;
    }
    if (entry.seq !== expectedSeq) return expectedSeq;
    if (entry.prevHash !== prev) return entry.seq ?? expectedSeq;
    const { prevHash: _prev, ...base } = entry;
    prev = chainHash(prev, base);
    actualLastSeq = entry.seq;
    actualLastHash = prev;
    expectedSeq++;
  }
  // Callers that ran the logger with persistence on MUST pass the sidecar
  // checkpoint. Without it, an attacker who can delete both the last N
  // JSONL lines AND the `.checkpoint` file ends up with an internally
  // consistent (but truncated) chain that would verify silently. Treat a
  // missing checkpoint as a tamper event under required-mode.
  if (expected === 'required') return actualLastSeq < 0 ? 0 : actualLastSeq + 1;
  if (expected && typeof expected === 'object') {
    if (actualLastSeq !== expected.lastSeq || actualLastHash !== expected.lastHash) {
      return actualLastSeq + 1;
    }
  }
  return null;
}
