# AInonymous Threat Model

Version: 1.2.2
Framework: STRIDE (primary), LINDDUN (appendix)
Last updated: 2026-04-19

This document describes the adversaries AInonymous is designed to mitigate, the adversaries it deliberately does not, and the residual risks that remain after the current mitigations. It is meant to be read alongside `SECURITY.md` (user-facing policy), `OPERATIONS.md` (deployment guidance) and `docs/HANDOVER.md` (open work items).

The tone is conservative on purpose. Anonymization is a risk-reduction control, not a privacy guarantee. Anywhere the text reads "mitigated", assume "reduces probability or blast radius" rather than "eliminates".

---

## 1. Scope

### In scope

- The proxy process itself: request interception, the 3-layer pipeline, the session map, SSE rehydration, the audit logger, the dashboard, the CLI wrapper.
- Data at rest produced by AInonymous: JSONL audit files, the shutdown token file in the OS temp directory, the `.ainonymous.yml` configuration file.
- Local IPC surface: the HTTP listener on `127.0.0.1:8100` and the `/shutdown`, `/metrics`, `/dashboard`, `/events`, `/health` endpoints.
- The supply chain of the npm package `ainonymous` and its transitive dependencies.
- Behavior under `AINONYMOUS_HOST=0.0.0.0` (container deployments), where the listener is exposed beyond loopback.

### Out of scope

- The upstream LLM provider. Once an anonymized request reaches `api.anthropic.com` or `api.openai.com`, the provider's own threat model and terms of service apply. AInonymous does not and cannot enforce anything past the TLS boundary.
- The operating system and its privilege model. A root/administrator user on the machine can read any process memory, inject into the node runtime, or replace binaries on disk. These attacks are not defended against.
- The user's own source code, prompts, or editor. If the user pastes an unredacted secret into a prompt that AInonymous has no pattern for, the secret leaves the machine. Detection coverage is best-effort (see Non-Mitigations).
- The LLM client tool (Claude Code, Cursor, Aider, Cody, Continue). AInonymous sets `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` and trusts the tool to use them. A tool that bypasses those env vars for telemetry or analytics endpoints is not protected against.
- Physical attacks, evil-maid scenarios, cold-boot key extraction.
- Post-quantum cryptographic attacks on AES-256-GCM.
- DSGVO-Compliance-Zertifizierung. The compliance presets are detection configurations, not legal attestations.

---

## 2. System Overview

### Architecture

```
+------------------------------------------------------------------+
|  User workstation (trust boundary 1: local OS / same UID)        |
|                                                                  |
|   +------------+        +-------------------------------+        |
|   | LLM client | --->   | ainonymous proxy (node:http)  |        |
|   | (claude,   |        |  127.0.0.1:8100               |        |
|   |  cursor,   |        |   - interceptor               |        |
|   |  aider)    | <---   |   - pipeline (L1/L2/L3)       |        |
|   +------------+        |   - session map (BiMap, AES)  |        |
|                         |   - audit logger (JSONL+chain)|        |
|                         |   - dashboard (SSE)           |        |
|                         +---------------+---------------+        |
|                                         |                        |
|                                         | anonymized request     |
|                                         v                        |
|                         +---------------+---------------+        |
|                         |  forwarder (keep-alive HTTPS) |        |
|                         +---------------+---------------+        |
|                                         |                        |
|   Filesystem:                           | TLS to upstream        |
|   - .ainonymous.yml                     |                        |
|   - ./ainonymous-audit/*.jsonl          |                        |
|   - $TMPDIR/ainonymous-<port>.token     |                        |
+-----------------------------------------+------------------------+
                                          |
                                          | public internet
                                          v
                           +------------------------------+
                           | upstream LLM (trust boundary |
                           |  2: remote, not controlled)  |
                           | api.anthropic.com            |
                           | api.openai.com               |
                           +------------------------------+
```

### Trust boundaries

- **TB1** user workstation <-> local adversaries on the same machine (same UID, different UID, kernel).
- **TB2** proxy process <-> upstream LLM provider over the public internet.
- **TB3** user <-> the `ainonymous` npm package and its transitive dependencies.

### Data flows worth naming

- **F1** client request body (may contain secrets/PII/domain code) from LLM tool to proxy over localhost HTTP.
- **F2** anonymized request body from proxy to upstream over TLS.
- **F3** upstream response body (may contain pseudonyms) back to proxy over TLS.
- **F4** rehydrated response body from proxy to client over localhost HTTP.
- **F5** audit entries (hashed originals, pseudonyms not persisted) from pipeline to JSONL on disk.
- **F6** dashboard SSE events (includes live pseudonyms, no originals) from audit logger to browser.
- **F7** session map writes (SHA-256 hashed forward, AES-256-GCM encrypted reverse) in process memory only.

---

## 3. Adversary Classes

### A1 - Lokaler Prozess mit gleichem UID

**Capability:** Read the process memory of the node runtime via `/proc/<pid>/maps` on Linux or `OpenProcess + ReadProcessMemory` on Windows. Read files the user owns, including `.ainonymous.yml`, the audit JSONL files and the token file in `$TMPDIR`. Connect to `127.0.0.1:8100`.

**Motivation:** Exfiltrate the session map key from heap memory (32 random bytes at `BiMap.key`, `src/session/map.ts:22`), then decrypt every reverse-lookup entry captured via memory scan. Alternatively, call `127.0.0.1:8100/shutdown?token=<stolen-from-tmpfile>` to disrupt, or send requests through the proxy to create audit-log noise.

**Typical actions:**
- Read `/tmp/ainonymous-8100.token` (mode 0600 on POSIX, default ACL on Windows) and invoke the shutdown endpoint.
- Attach to the node PID, dump the heap, scan for 32-byte sequences referenced near the string `aes-256-gcm` or the `BiMap` class metadata.
- Open a raw TCP connection to `127.0.0.1:8100` and fetch `/dashboard`, `/metrics`, `/events` - no authentication.

**Primary defense:** process isolation provided by the OS. AInonymous does not defend against same-UID attackers beyond the usual surface hardening.

### A2 - Kompromittierte Config

**Capability:** Can write to `.ainonymous.yml` in the project directory.

**Motivation:** Neutralize the anonymization pipeline so that secrets or PII flow through unmodified. Redirect upstream traffic to an attacker-controlled server to capture the "anonymized" data before it reaches Anthropic/OpenAI.

**Typical actions:**
- Remove all entries from `identity.domains` and `identity.people`; shorten `secrets.patterns` to nothing.
- Set `behavior.upstream.anthropic: https://evil.example.com` and `behavior.upstream.openai: https://evil.example.com`. The proxy trusts these values without pinning.
- Disable `audit_log` to suppress the trail.

**Threat classification:** this is equivalent to a supply-chain attack on the configuration file. If the attacker can write `.ainonymous.yml`, they can also write `~/.npmrc`, `~/.bashrc`, or the client tool's own config. The proxy's confidentiality guarantees assume the config is trusted input.

### A3 - Man-in-the-Middle auf dem Upstream-Pfad

**Capability:** Intercept TLS between the proxy and the LLM provider (for example: corporate TLS-interception proxy, hostile WiFi with a trusted root CA installed, state-level actor with a signed intermediate).

**Motivation:** Observe or modify the request/response traffic.

**Typical actions:**
- Passive capture of the forwarded request body to correlate pseudonyms back to originals via side channels (request timing, request volume, pseudonym overlap across tenants).
- Active modification of the response to exfiltrate data via a crafted pseudonym that rehydrates to an attacker-chosen string (see Residual Risks #3).

**What AInonymous contributes:** the request body already has secrets redacted and identifiers replaced with pseudonyms. The high-value payload (original names, domains, code identifiers) is not on the wire. TLS verification itself is delegated to Node.js defaults; there is no certificate pinning.

### A4 - Post-hoc Forensik

**Capability:** Obtain a core dump, a `node --heap-snapshot` file, a disk image or an OS hibernation file after the proxy has been running.

**Motivation:** Reconstruct the session map content after the fact.

**Typical actions:**
- Parse the heap snapshot for strings matching greek-letter pseudonyms (`AlphaCorp`, `BetaService`, ...) and corresponding encrypted buffers.
- Extract the 32-byte AES key referenced by the `BiMap` instance. Decrypt every `rev` entry.
- Search the audit JSONL for `originalHash` values, rainbow-table them against dictionaries of company names, common domains, CEO names.

**What AInonymous contributes:**
- No plaintext originals in `rev` (AES-256-GCM with per-process key, `src/session/map.ts:74-80`).
- `fwd` keys are SHA-256 hashes, so reading the forward map alone does not reveal originals.
- Audit log stores `originalHash` truncated to 32 hex chars (128 bits), no plaintext (`src/audit/logger.ts:9`).
- Key is held only in memory. No persistence flag, no environment-variable export.

**Residual weakness:** the AES key lives in heap memory as long as the process does. A heap snapshot taken during operation captures it. There is no key-zeroing, no mlock, no hardware-backed keystore.

### A5 - Böswilliger Upstream oder kompromittierte Response

**Capability:** The configured upstream API responds with attacker-controlled content.

**Motivation:** Exploit the rehydration step. If the upstream returns text containing a pseudonym the session map knows about, AInonymous substitutes the original. If it returns a pseudonym it does not know, rehydration is a no-op.

**Typical actions:**
- Echo the user's anonymized request back with additional pseudonyms appended, causing unexpected rehydration in the response.
- Produce a response large enough to trigger the 50 MB cap in the forwarder (`src/proxy/forwarder.ts:8`) and observe whether the proxy leaks state on abort.
- Craft SSE events that straddle pseudonym boundaries to exploit the known limitation in per-event-boundary rehydration (`AlphaCorp` + `Service` arriving in separate `data:` frames).

**Threat classification:** the upstream is a TB2 entity. Users choose to send requests there; the proxy is not a WAF between the user and the LLM.

### A6 - Supply-Chain

**Capability:** Publish a malicious version of `openredaction`, `tree-sitter`, `tree-sitter-wasms`, `commander`, `js-yaml` or any transitive dependency.

**Motivation:** Insert a preinstall/postinstall script that exfiltrates the developer's SSH keys, or patch the anonymization logic to forward originals alongside pseudonyms.

**Typical actions:**
- Typosquat `ainonymous` as `anonymity`, `ainonimity`, etc. A user who mistypes `npm install ainonymous` gets the attacker's package.
- Compromise a maintainer's npm token and publish a trojaned patch release of a direct dependency.
- Insert a runtime check that disables redaction if a specific header or config field is present.

**What AInonymous contributes:** SBOM is generated (mentioned in `HANDOVER.md`). `npm audit` reports 0 vulnerabilities at release. Deep dependency tree is intentionally shallow; `node:http`/`node:https` are used instead of express/axios.

**Residual weakness:** releases are not signed (P1-3 in `HANDOVER.md`). A malicious publish to npm under a compromised token would not be detectable until someone audits the diff. No package-lock verification is enforced by the install path (`npm install -g` vs `npm ci`).

---

## 4. STRIDE Analysis per Component

Legend:
- `mitigated` - attack is blocked or costs significantly more than the value returned.
- `partial` - some defenses present, known residual exposure documented here or in `SECURITY.md`.
- `not mitigated` - no defense; documented limitation.
- `out-of-scope` - belongs to a different trust boundary.

### 4.1 Proxy Server (`src/proxy/server.ts`)

| STRIDE | Threat | Status | Notes |
|---|---|---|---|
| S | Spoofed client on `127.0.0.1:8100` sending forged requests. | `mitigated` | Bind is `127.0.0.1` by default. `/shutdown` uses timing-safe token comparison. `/metrics`, `/dashboard`, `/events` and dashboard assets are bearer-token-protected when `behavior.mgmt_token` or `AINONYMOUS_MGMT_TOKEN` is set (Done, formerly P1-1). Without a token and on `0.0.0.0` the start command logs a warning. |
| T | Tampered request body reaching the pipeline. | `mitigated` | All bodies flow through the 3-layer pipeline; there is no bypass path. 10 MB body cap (`interceptor.ts:33`) prevents resource exhaustion by oversized requests. |
| R | User denies having made a request to the proxy. | `partial` | Audit log records hashed originals with a hash chain, but does not capture client identity (no PID, no UID, no process name). Useful for counting, weak for attribution. |
| I | Information disclosure via error responses. | `mitigated` | Errors are generic (`proxy_error`, `upstream_error`). Stack traces stay in the structured logger and are not returned on the wire (`src/proxy/server.ts:84-89`). |
| D | DoS via floods of connections or oversized bodies. | `partial` | 10 MB body cap, 50 MB response cap, 30 s upstream timeout, 50 keep-alive sockets per upstream. No connection rate limit. No per-client limits. A local attacker can saturate the event loop. Out of SECURITY.md scope. |
| E | Privilege escalation from the listener to the OS. | `out-of-scope` | Defense is the OS sandbox and (in production) the systemd unit's `SystemCallFilter` + `NoNewPrivileges=true`, documented in `OPERATIONS.md`. |

### 4.2 Pipeline (Layer 1 / Layer 2 / Layer 3)

| STRIDE | Threat | Status | Notes |
|---|---|---|---|
| S | Attacker content that impersonates a legitimate pseudonym. | `partial` | The session map is additive; once `asom.de -> alpha-corp.internal` is set, it stays. An attacker who can inject the string `alpha-corp.internal` into their own request will get rehydration to `asom.de` in the response. This is the crafted-pseudonym risk. See Residual Risks #3. |
| T | Regex bypass via encoded or obfuscated input. | `partial` | Secrets layer covers ~30 built-in patterns plus OpenRedaction's ruleset. Non-standard token formats, base64-wrapped JSON secrets and context-dependent PII slip through; acknowledged in `SECURITY.md` and README "Limitations". |
| R | Replacement was or wasn't applied - can an operator tell? | `mitigated` | Every replacement is a line in the hash-chained audit log with layer, type, offset, length. `verifyAuditChain` detects tampering of non-terminal entries. |
| I | Pseudonym collisions between unrelated originals. | `yes` | `PseudoGen` cycles 24 greek letters then appends numeric suffixes. Within-session collisions are prevented by the BiMap (same original → same pseudonym). A second original mapping onto an existing pseudonym now throws in `BiMap.set` rather than silently overwriting the reverse map. restart + `AINONYMOUS_SESSION_KEY` rotation resets the generator if the exception fires. |
| D | AST parsing hangs on adversarial source code. | `partial` | Tree-sitter WASM is generally robust. There is no explicit parse timeout. Very large files (>10 MB body cap blocks this at ingress) or pathological grammars could theoretically produce long parses. No reports observed. |
| E | AST extractor loads a crafted wasm module. | `out-of-scope` | The wasm modules are vendored via `tree-sitter-wasms` (supply chain, A6). No dynamic loading from user-controlled paths. |

### 4.3 Session Map (`src/session/map.ts`)

| STRIDE | Threat | Status | Notes |
|---|---|---|---|
| S | Attacker sets an entry they did not produce. | `mitigated` | `set()` is not exposed over the wire. Only pipeline code with a direct reference to the BiMap can call it. |
| T | In-process modification of the map. | `partial` | A same-process attacker (code injection, monkey-patched module) owns the game. A heap-scan attacker cannot modify without also scripting node, which is A1. Values in `rev` are AEAD-protected so silent tampering of encrypted blobs is detected on decrypt (`decipher.final()` will throw on bad tag). |
| R | Who added which entry? | `mitigated` | Meta map records `layer`, `type`, `createdAt` per entry (`map.ts:4-8`). |
| I | Reading entries back out reveals originals. | `partial` | In-process, yes - that is the function. For external adversaries, the cleartext originals exist only inside AES-256-GCM ciphertexts in memory plus the active key. See A1/A4. |
| D | Unbounded growth across a long session. | `partial` | Map is unbounded. `OPERATIONS.md` flags this (~463 bytes per entry including forward+reverse maps and encryption overhead, "plan accordingly"). A hostile prompt with millions of unique identifiers would grow the map without limit. No LRU, no TTL. |
| E | N/A | `out-of-scope` | No privilege boundary inside a single node process. |

### 4.4 Audit Logger (`src/audit/logger.ts`)

| STRIDE | Threat | Status | Notes |
|---|---|---|---|
| S | Attacker writes a forged audit file. | `partial` | Hash chain detects tampering of non-terminal entries; the last entry is unprotected. `SECURITY.md` and `OPERATIONS.md` both call this out. Mitigation: external checkpoint (digest + append-only store) on a schedule. |
| T | Modified audit entry in the middle of a file. | `mitigated` | `verifyAuditChain` returns the first bad seq. Break is detectable by anyone with the file. |
| R | Non-repudiation of replacements made. | `partial` | The log proves "a replacement of type X happened at offset Y" but does not prove which upstream request it belonged to (no request-id correlation). If correlation is required, emit a request-id from the proxy layer. |
| I | Plaintext originals appearing in the log. | `mitigated` | Only SHA-256 truncated hash of the original is persisted (`logger.ts:8-10, 39`). Pseudonyms were historically in the log; removed for GDPR Art. 4(5) compliance (see the comment at `logger.ts:32-34`). |
| D | Disk fills up because no retention. | `partial` | File rotates at 10 MB. `OPERATIONS.md` documents retention as operator responsibility with a cron example. Not enforced by the code. |
| E | N/A | `out-of-scope` | |

### 4.5 Dashboard + SSE (`src/audit/dashboard.ts`)

| STRIDE | Threat | Status | Notes |
|---|---|---|---|
| S | Unauthenticated client subscribes to `/events`. | `mitigated` (if token set) | With `AINONYMOUS_MGMT_TOKEN` set, `/events` requires bearer auth. Without a token on loopback, any same-UID process can still subscribe and receive the live pseudonym stream (`broadcastEntry` includes `pseudonym`). The original is not included, but the pseudonym lets an attacker replay it in a later prompt to learn the mapping. Strong-recommend: set a token for any workflow where untrusted same-UID processes could run. |
| T | Script injection via audit content rendered in dashboard. | `mitigated` | CSP is `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`. No `'unsafe-inline'`, no `'unsafe-eval'`. Dashboard JS and CSS are served as same-origin files with `nosniff`. Audit entries going to the dashboard contain `type` and `layer`, written to the DOM via `textContent` / `createElement` only. |
| R | User denies viewing the dashboard. | `out-of-scope` | No access log per connection. |
| I | Live pseudonym leak over `/events`. | `partial` | As above: pseudonym visible, original not. Volume + timing is a side channel. |
| D | Many long-lived SSE connections exhaust file descriptors. | `partial` | No client cap; client list is an unbounded array (`dashboard.ts:22`). A local attacker can open many `/events` connections. |
| E | N/A | `out-of-scope` | |

### 4.6 CLI and Wrapper Mode (`src/cli/cmd-start.ts`, `src/cli/wrapper.ts`)

| STRIDE | Threat | Status | Notes |
|---|---|---|---|
| S | Attacker runs `ainonymous stop` without authorization. | `partial` | Token file is `$TMPDIR/ainonymous-<port>.token`, mode 0600 on POSIX. Windows default ACL is not guaranteed private (P5-14 flags this). Any same-UID process on POSIX can still read mode-0600 files. |
| T | Wrapper child-process injection. | `mitigated` | `wrapper.ts` uses `spawn` with argv arrays, not shell strings. |
| R | Which command triggered which shutdown? | `out-of-scope` | No CLI audit trail. |
| I | Token written to a world-readable location. | `partial` | POSIX: 0600 in `tmpdir`. Windows: default ACL. The `/shutdown` endpoint uses timing-safe comparison, so leaking the token is the primary concern. |
| D | N/A | `out-of-scope` | |
| E | Wrapper inherits env and writes to it. | `partial` | Wrapper sets `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` for the child only. If the child spawns its own children and passes env through, the anonymization chain is intact. If the child performs native HTTP without respecting those env vars, traffic bypasses the proxy entirely. |

---

## 5. Top Residual Risks (ranked)

### R1 - Management endpoints on loopback without token

Management endpoints (`/metrics`, `/metrics/json`, `/dashboard`, `/dashboard/app.*`, `/events`) accept a bearer token from `behavior.mgmt_token` or `AINONYMOUS_MGMT_TOKEN` and reject requests without it. Without a token set on `127.0.0.1`, any same-UID process can still subscribe and in particular read the live pseudonym stream via `/events`. This does not leak originals but lets an attacker replay pseudonyms to learn mappings. Strong-recommend: set a token whenever untrusted same-UID processes could be running. Network-layer isolation (NetworkPolicy example in `OPERATIONS.md`) remains recommended as defense in depth, especially on `AINONYMOUS_HOST=0.0.0.0`.

### R2 - Session map key in heap memory for the process lifetime

The 32-byte AES key is generated in the `BiMap` constructor and never zeroed (`src/session/map.ts:22-26, 67`). A `node --heap-snapshot` taken while the proxy runs contains the key as a plain byte buffer. Anyone with that file can decrypt every reverse-lookup entry in the snapshot. Mitigation: avoid heap snapshots in production; set `ulimit -c 0` to disable core dumps; hibernate/suspend disabled on workstations where `.ainonymous.yml` routes real secrets. No in-process mitigation planned (mlock is not portable to Windows; hardware keystores are out of scope for a node CLI).

### R3 - Crafted-pseudonym rehydration in malicious upstream responses

A compromised upstream can emit the string `alpha-corp.internal` in a response; the rehydrator will substitute `asom.de`. More generally, any pseudonym the session has ever generated will rehydrate. An attacker upstream can therefore "decrypt" the session map one pseudonym at a time by echoing candidate pseudonyms. This is not a bug per se - it is what rehydration does - but it means the LLM provider (or anyone who can tamper with its responses) learns originals for pseudonyms they observed, which undermines the confidentiality story against A3/A5. Mitigation today: none. Long-term: constrain rehydration to response ranges the model actually wrote (requires signed-response primitive that neither Anthropic nor OpenAI offers). Acknowledged as a fundamental limit of the design.

### R4 - SSE pseudonym split across events is not rehydrated

Documented in `SECURITY.md`. An SSE event boundary can land mid-pseudonym (`Alpha` / `Corp` / `Service` in three frames). The rehydrator operates per event, so fragments stay pseudonymized. Result: the user sees the pseudonym instead of the original. This is a functional bug rather than a leak - no original leaves the machine - but it undermines the "responses are rehydrated" claim in the README. Tracked as P2-4. Workaround: non-streaming requests are unaffected.

### R5 - Supply-chain integrity of published releases

The package is built and published through GitHub Actions. Releases are signed via Sigstore (keyless, via GitHub OIDC) and npm publishes carry a provenance attestation (P1-3, closed). A compromised npm token could still publish a trojaned `ainonymous@latest`, but downstream users can detect it via `npm audit signatures` (rejects missing/invalid provenance) and cosign verification of the GitHub Release tarball. Mitigation today: pin to an exact version (e.g. `"ainonymous": "1.2.2"`, not `^`), run `npm audit signatures` before upgrading, diff-review the diff between tags for unexpected dependency additions.

### Audit integrity: chain-consistency vs tamper-evidence

The v1.2.x hash-chain verifier is a consistency check, not cryptographic tamper-evidence. It catches an attacker who modifies an entry mid-chain (the next entry's `prevHash` disagrees), but an attacker with write access to both the JSONL file and the `.checkpoint` sidecar can truncate both and recompute a clean chain. The `.checkpoint` requires no signer identity.

An HMAC-sidecar (a short tag, rolling key, server-side only, rotated with `AINONYMOUS_AUDIT_HMAC_KEY`) is tracked for v1.3. Until then, operators who need tamper-evidence in the cryptographic sense should replicate `.checkpoint` files to an append-only store (S3 Object Lock, remote syslog, git commit) so the external medium provides the evidence the current scheme does not. See `SECURITY.md` → "Audit-log truncation detection".

---

## 6. Non-Mitigations (honest list)

AInonymous does not protect against:

- **Root or administrator on the machine.** Read-process-memory wins.
- **Malicious same-UID process** running concurrently with the proxy. Same UID has too much access for a userspace anonymizer to meaningfully defend against.
- **A user who bypasses the proxy.** If the developer disables `ANTHROPIC_BASE_URL` or points the tool directly at the provider, the proxy is not in the path.
- **Secrets embedded in code that no pattern recognizes.** Custom token formats, odd key shapes, JSON-wrapped credentials, base64-in-base64. Detection is best-effort; `SECURITY.md` is explicit.
- **Persons whose names are not in the NER dictionary.** CJK, Scandinavian and Middle Eastern names are sparse. Add explicit entries via `identity.people`.
- **Correlation attacks by the upstream provider.** If the same user sends enough requests, the provider can build a pseudonym frequency profile that identifies the user by writing style, even without originals.
- **Legal compliance.** Using `compliance: gdpr` loads detection patterns for common GDPR data types. It does not make the deployment GDPR-compliant. A DPA, an Art. 30 record and a legal review are the user's responsibility. P3-6/P3-7 provide templates as a starting point.
- **Multi-tenant isolation.** There is no tenant concept. One session = one proxy process = one session map.
- **Cross-restart session continuity.** By design: restart = new session map = pseudonym set rebuilt from scratch. In-flight requests spanning a restart will fail to rehydrate correctly. P1-2 tracks optional SQLite persistence.

---

## 7. Trust Assumptions

- The user controls their own machine. If that is not true, the game is already lost.
- The Node.js runtime is trusted. A malicious `node` binary is out of scope.
- The operating system enforces its own process and file isolation.
- TLS to the upstream provider is trusted transitively through the system trust store. No certificate pinning.
- The npm registry delivered the same tarball to everyone (same-version-same-hash). If registry integrity is broken, A6 applies.
- The user's `.ainonymous.yml` is honest. A compromised config is treated as a compromised host.
- The upstream LLM provider handles the anonymized payload according to their terms. AInonymous does not inspect what the provider does with it.

---

## 8. Future Work

- **P1-1** ~~Auth on `/metrics`, `/dashboard`, `/events`.~~ Done: bearer token via `behavior.mgmt_token` / `AINONYMOUS_MGMT_TOKEN`. See `SECURITY.md` → "Management endpoint auth".
- **P1-2** ~~Optional session map persistence.~~ Done: opt-in AES-256-GCM SQLite store via `node:sqlite` (requires Node.js 22.5+). See `SECURITY.md` → "Session Map Persistence".
- **P1-3** ~~Signed releases (Sigstore/Cosign) and signed SBOM.~~ Done in `.github/workflows/release.yml`; activates on the first `v*` tag push. Closes A6 publish-side.
- **P2-4** ~~JSON-aware SSE delta reassembly.~~ Done via per-content-block sliding buffer in `src/proxy/stream-rehydrator.ts`. R4 resolved.
- **P5-12** ~~Dashboard CSP without `'unsafe-inline'`.~~ Done: `dashboard/app.js` and `dashboard/app.css` are same-origin. See `SECURITY.md` → "Dashboard CSP".
- **P5-14** ~~Windows ACL for the shutdown token file.~~ Done: stored under `%USERPROFILE%\.ainonymous\` with best-effort icacls hardening.
- **v1.2 candidates** still open: Unicode confusables table (Cyrillic/Latin homoglyph bypass of keyword regexes); HMAC (keyed) instead of plain SHA-256 for the audit chain so an insider with write access cannot forge the tail; pseudonym-replay guard so a user replaying a pseudonym they saw in the dashboard cannot drive rehydration; per-regex timeout for user-supplied `secrets.patterns` to defuse ReDoS in hostile configs.

---

## 9. LINDDUN Addendum (GDPR lens)

Brief mapping for privacy-specific reviewers. STRIDE above remains the primary analysis.

| LINDDUN category | Relevant component | Assessment |
|---|---|---|
| **L**inkability | Session map, audit log | Originals within one session are linkable via the forward map (hash of original -> pseudonym). Cross-session linkability is limited because the key and greek-letter sequence regenerate per session. The audit log's `originalHash` is deterministic SHA-256 with no per-session salt, so the same original produces the same hash across sessions - linkable by an attacker with both logs. Consider per-session salting if this matters. |
| **I**dentifiability | Pipeline output | The point of the pipeline is to reduce identifiability of the outgoing payload. The residual identifiability risk is the profile/writing-style channel (Top Risks section) and the detection-gap channel (secrets or names not covered by patterns). |
| **N**on-repudiation | Audit log | Hash chain provides integrity for non-terminal entries but no identity binding. The log cannot be used to prove who operated the proxy. If that is required (SIEM audits), pair with OS-level process accounting. |
| **D**etectability | Metrics endpoint, dashboard SSE | An observer on the machine can detect request volume and layer breakdown through `/metrics` and `/events`. Timing correlation with the LLM tool's network activity reveals when the user is using AI. Acceptable for single-user workstations; documented limitation in container deployments. |
| **D**isclosure of information | Audit log, session map | As covered in STRIDE I rows. Plaintext is not at rest; ciphertext + key in memory is. |
| **U**nawareness | UX | The dashboard shows what is being anonymized in real time. `ainonymous scan` lets users preview before sending. README flags limitations explicitly. Users should not be unaware, but the responsibility is theirs to review. |
| **N**on-compliance | Compliance presets | Using `compliance: gdpr` configures detection patterns. It does not attest compliance. No automatic DPIA, no automatic Art. 30 record. Templates tracked as P3-6/P3-7. |

---

## Changelog of this document

- 2026-04-16 (v1.1.2): Version header bumped to 1.1.2; R5 mitigation text updated to reflect the now-closed P1-3 (Sigstore keyless + npm provenance); deferred items relabeled from "v1.1 candidates" to "v1.2 candidates". No threat-analysis change - identical controls and residual risks as v1.0.0.
- 2026-04-16 (v1.0.0): Initial version.
