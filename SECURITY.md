# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a Vulnerability

Please use GitHub's private vulnerability reporting: open the repository's **Security** tab and click **Report a vulnerability**. Do not open a public issue for security problems.

Include what you can: description, reproduction steps, impact, and any suggested fix.

This is a solo-maintained project — responses are best-effort, typically within a few days. Critical issues are prioritized; feel free to ping again if you don't hear back.

## Scope

In scope:
- Data leakage through the proxy (original data reaching upstream APIs)
- Session map confidentiality weaknesses
- Authentication bypass on shutdown/dashboard endpoints
- Dependency vulnerabilities in the supply chain. `openredaction`, `tree-sitter-wasms`, and `web-tree-sitter` are pinned to exact versions: they control detection logic and grammar definitions respectively, so a seemingly innocuous patch release could silently change what gets anonymized. `commander` and `js-yaml` remain on caret ranges because their API surface is stable and heavily reviewed.

Out of scope:
- Attacks requiring local system access (the proxy runs locally by design)
- Denial of service on the local proxy
- Issues in upstream LLM APIs

## Security Design

- All traffic stays on localhost. The only outbound connection is the anonymized payload to the configured LLM endpoint. When binding to a non-localhost interface (e.g. Docker `0.0.0.0`), set `AINONYMITY_MGMT_TOKEN` or `behavior.mgmt_token` to protect the management endpoints (`/metrics`, `/metrics/json`, `/dashboard`, `/dashboard/app.js`, `/dashboard/app.css`, `/events`). Without a token on `0.0.0.0` the start command logs a warning but still boots.
- The session map's reverse lookup (pseudonym → original) is AES-256-GCM encrypted with a fresh random key per process. The forward lookup uses SHA-256 hashed keys. Keys live only in process memory; there is no persistence. The map also holds a lazily-built in-memory snapshot of decrypted originals to avoid re-running AES-GCM on every rehydration call — this is a performance vs exposure-window tradeoff. The snapshot is wiped on every `set()`, `clear()`, and `rotateKey()`, and never written to disk. It represents the same cleartext that already transits the heap during each normal decrypt; no new leak vector, just a longer residency.
- Secrets (API keys, passwords, tokens) are permanently redacted, never rehydrated.
- The shutdown endpoint uses timing-safe token comparison with a per-process token. The token file location and permissions depend on the platform (see "Shutdown Token Storage" below). Management endpoints use the same timing-safe comparison on `Authorization: Bearer <token>`.
- Error responses are generic; internal paths and stack traces are not returned to the client.

### Dashboard CSP

The dashboard ships as three same-origin files: `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js`. There are no inline `<script>` or `<style>` blocks and no inline event handlers. The HTML response carries this header:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'none'
```

No `'unsafe-inline'` and no `'unsafe-eval'`. Asset responses set `x-content-type-options: nosniff` and an explicit `content-type` to block MIME sniffing.

### Dashboard access when a mgmt token is set

When `AINONYMITY_MGMT_TOKEN` / `behavior.mgmt_token` is configured, `/dashboard`, `/dashboard/app.js`, `/dashboard/app.css`, and `/events` all require `Authorization: Bearer <token>`. A plain browser cannot attach a bearer header from `<link>` / `<script>` / `EventSource`, so hitting `http://host:8100/dashboard` from a browser returns 401 once a token is set. Options:

- **Localhost only (default):** leave the token unset, keep the bind on `127.0.0.1`. Any same-UID process can reach the dashboard; that is the threat model documented in `THREAT_MODEL.md` R1.
- **Non-localhost bind:** put the proxy behind a reverse proxy (nginx, Caddy, Traefik) that terminates its own authentication (Basic-Auth, OIDC, mTLS, IP allow-list) and forwards requests with the `Authorization: Bearer <token>` header added. Keep the proxy's own listener on `127.0.0.1` or a non-routable interface.
- **Headless access:** `curl -H "Authorization: Bearer $TOKEN" http://host:8100/metrics` works as-is. The HTML dashboard is browser-facing; automation should hit `/metrics` or `/metrics/json` directly.

Query-parameter tokens are deliberately not accepted for the management / dashboard token — URLs end up in proxy logs, browser history, and referrer headers. The separate `/shutdown` endpoint is a narrow exception: it accepts `?token=` because it is ephemeral (the process terminates on success), never hit from a browser, and the token is a fresh per-process value read from a `0600` file — so the referrer / history vectors do not apply.

### Shutdown Token Storage

The `ainonymous start` command writes a random per-process token to disk so that `ainonymous stop` (and only `ainonymous stop`) can terminate the proxy. The token is a 128-bit hex string, freshly generated on every start, and is compared using `crypto.timingSafeEqual` on the server.

- **POSIX (Linux, macOS)**: `$TMPDIR/ainonymity-<port>.token`, file mode `0600` (user read/write only). The temp directory is typically world-readable but the file itself is not.
- **Windows**: `%USERPROFILE%\.ainonymity\ainonymity-<port>.token`. The parent directory is created with mode `0700` and the file with `0600`. After the write, `icacls` is invoked to remove inherited ACLs and grant only the current user `(R,W)`. The `icacls` call is best-effort: if it fails (icacls missing, running as a stripped service account, etc.) the process logs a warning and continues. On a standard Windows install the user profile is already user-only by default, so the `icacls` step is defence-in-depth rather than the primary control.

Rationale for the Windows path: `%TEMP%` (typically `%USERPROFILE%\AppData\Local\Temp`) inherits ACLs from the user profile and in most setups is user-only, but enterprise-managed machines and GPO-driven environments can widen those ACLs. Placing the token directly under `%USERPROFILE%\.ainonymity\` plus explicit `icacls /inheritance:r` makes the protection independent of profile-level policy.

If the icacls hardening fails and you run on a multi-user or domain-joined machine, you can manually tighten the directory:

```powershell
icacls "$env:USERPROFILE\.ainonymity" /inheritance:r /grant:r "$env:USERNAME:(OI)(CI)(F)"
```

The token is only valid while the proxy is running. On clean shutdown the file is deleted. A stale token file (left over after a crash) cannot be used against a later proxy instance because each start generates a fresh token.

## Verifying Release Artifacts

Starting with the GitHub Actions release workflow, every release is signed with [Sigstore](https://sigstore.dev) (keyless, via the workflow's OIDC token) and every npm publish carries an [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements). You do not have to verify, but if you run this in a regulated environment it is a cheap second opinion that the artifact on disk matches what the release workflow produced.

### What is published

Each GitHub Release attaches:
- `ainonymity-<version>.tgz` — tarball produced by `npm pack` in the release workflow
- `ainonymity-<version>.tgz.sha256` — SHA-256 checksum
- `ainonymity-<version>.tgz.sigstore.json` — Sigstore bundle (signature + certificate + transparency log proof)
- `ainonymity-<version>.tgz.sig` and `.tgz.pem` — same signature and Fulcio certificate in split form, for tooling that doesn't speak bundles yet
- `sbom.cdx.json` — CycloneDX SBOM, also signed (`sbom.cdx.json.sigstore.json`)

The tarball on the GitHub Release and the tarball on the npm registry both come from the same `npm run build` output in the same job, but they are not guaranteed to be byte-identical: `npm publish` packs its own tarball internally. If you want to verify the npm-registry artifact, use `npm audit signatures` (provenance). If you want to verify the GitHub Release asset, use cosign as shown below.

### Verifying the tarball

Install cosign (`brew install cosign`, `apt install cosign`, or grab a binary from [sigstore/cosign releases](https://github.com/sigstore/cosign/releases)), download the tarball plus its `.sigstore.json` from the Release page, then:

```bash
VERSION=1.0.0   # replace with the version you downloaded

cosign verify-blob "ainonymity-${VERSION}.tgz" \
  --bundle "ainonymity-${VERSION}.tgz.sigstore.json" \
  --certificate-identity "https://github.com/A-Som-Dev/ainonymity/.github/workflows/release.yml@refs/tags/v${VERSION}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

A successful run prints `Verified OK`. Any other output (cert mismatch, expired bundle, wrong identity) means the artifact was not produced by this repository's release workflow — treat it as untrusted.

If you pulled the release from a branch instead of a tag (unusual), adjust the `@refs/tags/v${VERSION}` suffix to the ref cosign reports in the error message.

### Verifying the SBOM

```bash
cosign verify-blob sbom.cdx.json \
  --bundle sbom.cdx.json.sigstore.json \
  --certificate-identity "https://github.com/A-Som-Dev/ainonymity/.github/workflows/release.yml@refs/tags/v${VERSION}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

### Verifying the npm package

The npm CLI knows how to check provenance attestations itself — no cosign needed:

```bash
npm install -g ainonymous    # or add it as a dep in a scratch project
npm audit signatures
```

Output should include `verified registry signature` and `verified attestation` for `ainonymity`. If `npm audit signatures` reports a missing or invalid attestation for a version, do not trust that version.

## Session Map Persistence (opt-in)

By default the session map lives only in process memory and is discarded on exit. Setting `session.persist: true` in `.ainonymity.yml` (optionally with `session.persist_path: "./ainonymity-session.db"`) enables a SQLite-backed write-through cache so that pseudonyms survive restarts — useful when an in-flight LLM response arrives after the proxy was restarted, or when multiple short-lived wrapper invocations (`ainonymous -- git commit`) need a shared mapping.

Requires **Node.js 22.5 or newer**, because the feature uses the built-in `node:sqlite` module (no native build dependencies). On older Node versions the proxy refuses to start when `session.persist` is true with a clear error; everything else keeps working.

Confidentiality model:

- Rows in the DB are stored as AES-256-GCM ciphertext, not cleartext. Each row carries `(original_hash, pseudonym_hash, original_enc, pseudonym_enc, iv, tag)`.
- Lookup uses `original_hash = SHA-256(original)` (same for pseudonym). The hash is **not salted** because deterministic lookup is the whole point. An attacker with read access to the DB file can brute-force known candidates (common names, email addresses) by hashing them and checking for matches. Treat DB-file access as a post-compromise scenario.
- The AES key is never persisted. Set `AINONYMITY_SESSION_KEY` to a base64-encoded 32-byte value to reuse the same key across restarts; without it each process starts with a fresh random key, which makes any existing DB unreadable and effectively wipes it on next write. Key hygiene is the user's responsibility.
- Key rotation re-encrypts every persisted row in a single SQLite transaction. If any row fails to decrypt with the old key, the rotation throws and the DB is left on the old key.
- Only one writer process is supported. The DB uses WAL mode so concurrent readers are fine, but running two `ainonymous start` instances against the same DB is undefined behavior.
- TTL-based cleanup is not implemented. The DB grows monotonically until `clear()` or manual deletion.

When in doubt: leave `session.persist: false`. The feature exists for continuity, not for audit retention.

## Unicode Normalization

Pattern detectors (`matchSecrets`, `matchPII`, `matchInfra`) normalize their input before running regexes, so common bypass payloads do not slip through:

- **Zero-width characters** (`U+200B`, `U+200C`, `U+200D`, `U+FEFF`) are stripped. An attacker injecting `ap\u200Bi_key = "sk-ant-..."` still gets redacted because the detector sees `api_key = "sk-ant-..."` after normalization, while the match span is mapped back to the original offsets so the whole original (including the zero-width char) gets replaced.
- **Compatibility equivalents** fold under NFKC per-codepoint: fullwidth Latin (`\uFF53\uFF45\uFF43\uFF52\uFF45\uFF54` → `secret`), ligatures (`ﬁ` → `fi`), and similar compatibility characters are unified with their plain-ASCII equivalents before regex matching.
- **Precomposed accented letters** (ä, ö, ü, é, ...) are kept intact, so German address patterns and other European-language detectors continue to match without false negatives.

Not covered (future work):

- **Confusables / homoglyphs** such as Cyrillic `а` (U+0430) vs Latin `a` (U+0061) are not unified. Under NFKC these remain distinct codepoints, so a deliberate Cyrillic-`а`pi_key still slips past the keyword detectors. Defeating this requires a Unicode Confusables mapping table similar to UTS #39, which is tracked as a separate hardening item.
- **Combining-mark injection** (e.g. plain `e` followed by `U+0301` combining acute) is not folded per-codepoint. Only the composed form is detected; patterns may miss sequences that visually resemble `é` but are encoded as two separate codepoints.
- **Tree-sitter identifier extraction** (Layer 3) runs on the original text because the AST parser handles its own token lexing; normalization is applied at the regex detection layer only.

## Known Limitations

- `sensitive_paths` and `redact_bodies` apply only during `ainonymous scan`. The proxy does not know which file a request originates from, so file-level rules cannot be enforced at proxy time. Use `// @ainonymity:redact` annotations for proxy-time body redaction.
- AST-based identifier extraction covers top-level declarations (classes, methods, top-level consts). Local variables inside functions, destructured bindings, generics, and catch variables are not individually pseudonymized.
- Regex detectors are best-effort. Complex patterns (JSON-embedded secrets, non-standard token formats) may slip through. Review the output of `ainonymous scan` on your codebase before relying on the proxy for compliance-critical workflows.
- SSE streaming uses a per-content-block sliding buffer to reassemble `text_delta` events before rehydration, so pseudonyms split across deltas (e.g. `"Alpha"` + `"Corp"` + `"Service"`) are restored correctly. The window is sized from the current session map's longest pseudonym, so anything generated by this proxy fits inside. A pseudonym that somehow appears in an upstream reply but is longer than any entry in the session map falls back to event-boundary replacement and may still be split; this only matters when mixing pseudonyms from a separate session into a shared stream, which is not a supported configuration.
- NER is dictionary-based. Names not in `src/patterns/ner.ts` (currently heavy on DE/EN/TR/AR/PL/IT; sparse for CJK, Scandinavian, Middle Eastern) will not be detected via NER. Add them explicitly via `identity.people` in the config.
- The built-in IBAN regex expects four digits after the two-letter country prefix, which covers DE/FR/ES/IT/NL/BE/PT/AT/CH digit-layouts but misses GB-style IBANs that contain a bank-letter block (`GB82 NWBK ...`). Turn on `behavior.compliance: gdpr` or `finance` to hand IBAN detection to OpenRedaction's pattern library, which handles the full country set. A replacement regex covering all ISO 13616 country codes is tracked as a v1.1 item.
