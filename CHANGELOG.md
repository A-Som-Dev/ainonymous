# Changelog

All notable changes to AInonymous are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/).

## [1.3.0] - 2026-04-23

Detection-side Unicode hardening plus the filter-framework and offline-preview
tooling. The SemVer chain stays additive and non-breaking; existing configs
keep running without edits.

### Fixed

- Audit checkpoint and watermark sidecars are written via a shared
  write-then-rename helper. A crash mid-write can no longer leave a torn
  JSON body that a subsequent restart would silently treat as absent or
  corrupt.
- NER hit name slices come from the NFKC + zero-width-stripped form so the
  SessionMap key is identical for `Thomas​Mueller` and a clean
  `Thomas Mueller` repeat. Without this a second request would allocate a
  fresh pseudonym instead of reusing the first.
- Layer 3 skips the tree-sitter AST pass when `code.language` is `unknown`,
  so infra-only repos (Helm, Terraform, Ansible) stop paying the WASM-init
  cost on every request.
- `cmd /c start` URL is validated for scheme, loopback host and shell
  metacharacters before launch, including caret (`^`), parentheses and
  CR/LF. The mgmt token in the dashboard URL is `encodeURIComponent`-wrapped.
- Detector-loader and OrPostFilter-loader share one pinned-module helper
  with full HEX64 pin validation. The detector path was missing the
  format check before this release.
- FREE_PROVIDERS picks up `aol.de`, `zoho.com` and `fastmail.com` so a
  global git `user.email` on any of those domains stops surfacing as a
  detected company.
- `BiMap.set` rejects originals that are themselves a sentinel literal
  (`***REDACTED***`, `***ANONYMIZED***`). Previously an upstream payload
  echoing a sentinel could poison the map. Sentinels remain accepted as
  pseudonyms (fan-out tracked separately via `sentinelFanoutCount`).
- `PseudoGen` for `identifier` and `person` retries when the generated
  greek-letter pseudo happens to equal the original. Skip count exposed
  via `identityMapSkips()` for debug/audit.
- Rehydrate runs a second pass for IPv6 pseudonyms that matches in
  canonical form (fully expanded, lowercase). A response that rewrites
  the pseudo with leading-zero padding or uppercase hex now resolves
  back to the original.
- `normalizeForDetection` now runs full-string NFKC per Unicode grapheme
  cluster before the category strip. Cross-codepoint compositions (Hangul
  L+V jamo to precomposed syllable, CJK compatibility sequences, combining
  mark normalisation) that the previous per-codepoint call skipped now
  reach the substring matcher in the expected form.
- Latin, Cyrillic and Greek confusable letters fold to their ASCII baseline
  on the detection side only. Long S (U+017F), dotless i (U+0131), Turkish
  capital I with dot (U+0130), the Cyrillic lowercase set (а е о р с х у i
  j s) and equivalent uppercase glyphs no longer bypass glossary or secret
  key-name matching. Rehydrated output keeps the original codepoints, so
  legitimate non-Latin content in LLM responses is unaffected.
- Rehydration strips category-Cf characters, variation selectors and the
  width-zero filler set from upstream responses before running the
  pseudonym-to-original substitution. A pseudonym split by ZWJ, ZWNJ, or
  Combining Grapheme Joiner still lines up with the session map.

### Added

- Watermark schema v=2 records the OS boot identifier on Linux
  (`/proc/sys/kernel/random/boot_id`) and folds it into the HMAC body, so a
  watermark copied across kernel boot sessions on the same machine breaks
  signature verification under HMAC mode. Same-host containers share the
  host kernel boot_id, so the witness is cross-boot defense, not
  cross-pod. macOS and Windows return null until a real native source is
  wired in. Legacy v=1 watermarks remain readable and migrate to v=2 on
  the next persistEntry.
- `ainonymous doctor` gains three checks: a stale `venv/` warning, a
  language-override sanity check that warns when `code.language: unknown`
  but a `package.json` / `pom.xml` / `go.mod` is in the repo, and a real
  checkpoint-vs-jsonl-tail drift scan that surfaces a stale or rolled-back
  checkpoint as a warning.
- `behavior.oauth_passthrough` (default `false`) forwards paths outside
  `/v1/messages` and `/v1/chat/completions` directly to the configured
  upstream without body anonymization. Enables OAuth subscription clients
  (Claude Code Max-Plan, Cursor Pro) that use refresh / organization
  endpoints alongside the chat route. The `Authorization` header has
  always been passed through; this flag widens which paths the proxy
  will accept at all.
- Optional HMAC tamper-evidence for audit logs. When
  `AINONYMOUS_AUDIT_HMAC_KEY` is set (base64-encoded 32-byte key), each
  persisted entry is accompanied by a `.hmac` sidecar entry containing
  the HMAC-SHA256 of the serialized line. `audit verify` cross-checks
  the sidecar and returns `tamper` when an entry was modified or the
  sidecar is missing while the key is configured. Key management
  (generation, rotation, backup, rotation on leak) is the operator's
  responsibility; the proxy does not auto-generate or persist the key.
  Without the key, audit integrity falls back to the v1.2.x hash-chain
  consistency check.
- `audit verify` validates the `.checkpoint` sidecar against a strict
  schema (integer `lastSeq >= 0`, 64-char lowercase-hex `lastHash`)
  before comparing it to the chain. A truncated, empty, or structurally
  malformed checkpoint now fails fast with a tamper result instead of
  cascading through the chain verifier.
- README `Limitations` section documents that OAuth-authenticated
  subscriptions (Claude Code Max-Plan, Cursor Pro) do not route through
  the proxy by design, and points at the separate-API-key workaround.
- README `Install` section gains a Windows setup subsection covering
  `%USERPROFILE%\.ainonymous\`, `nssm` for service wrapping, and the
  PowerShell environment-variable syntax.
- HMAC keyring for audit sidecars. Export one key per kid through
  `AINONYMOUS_AUDIT_HMAC_KEY_<KID>` env vars and point
  `AINONYMOUS_AUDIT_HMAC_ACTIVE_KID` at the signer. Older kids stay
  verifiable as long as their env var is exported, so rotation no
  longer forces an archival flush. The legacy single-key
  `AINONYMOUS_AUDIT_HMAC_KEY` continues to work as kid `default`.
- `/metrics` surfaces `ainonymous_identity_map_skips_total`
  (PseudoGen identity-collision retries), `ainonymous_sentinel_fanout`
  per sentinel pseudonym, and `ainonymous_audit_hmac_verify_failures_total`
  (files with broken HMAC sidecar). `audit pending` grows a
  `tamper-impacted` bucket for entries in files whose sidecar failed
  verify.
- StreamRehydrator also rewrites pseudonyms inside Anthropic
  `thinking_delta` content blocks. `input_json_delta` fragments are
  forwarded unchanged so tool-call JSON stays parseable even if an
  original contains embedded quotes or backslashes.
- Persisted counter reservations are guarded against
  `Number.MAX_SAFE_INTEGER` overflow; the HMAC keyring rejects
  collisions between the legacy env var and an
  `AINONYMOUS_AUDIT_HMAC_KEY_DEFAULT` alias, and kids must now start
  with `[a-z0-9]` and stay under 64 characters.
- SessionMap persistence reserves a per-process counter block
  (`counters` meta table) so sibling proxies sharing one SQLite file
  no longer generate colliding identifier/person pseudonyms.
- CycloneDX SBOM is now bundled inside the npm tarball
  (`sbom.cdx.json` in the package files) in addition to being
  published as a GitHub release asset. The generator version is
  pinned to `@cyclonedx/cyclonedx-npm@4.2.1` across CI, release and
  Makefile targets.
- `filters:` config section. `filters.disable` removes built-in OrPostFilters
  (`always-disabled`, `country-ids`, `credit-card-preset`) from the effective
  chain. `filters.custom` loads project-local `.mjs` filter modules behind a
  trust gate.
- `trust.allow_unsigned_local` config flag. Required for `filters.custom`
  to actually load. Refusing to run unsigned local code by default keeps
  the trust-model explicit.
- `ainonymous filters list` prints the active OrPostFilter chain with
  descriptions; lists disabled filters separately.
- `ainonymous filters validate <path>` performs the full shape check of a
  custom filter without registering it.
- `ainonymous preview --input-file <path>` runs the anonymization pipeline
  offline against a file or stdin and emits either human-readable text plus a
  finding summary or `--json` for CI pipelines.
- `behavior.streaming.eager_flush` opt-in. Releases buffered response text at
  sentence/newline boundaries instead of holding the full sliding window.
  Trade-off (false-negative risk when a pseudonym straddles a boundary)
  is documented in the stream-rehydrator source.
- `auto-detect` derives aliases from `pyproject.toml`, `setup.py`,
  `README.md` H1 lines and `git remote get-url origin` in addition to the
  existing `package.json` and `pom.xml` sources.
- `ainonymous/plugin-api` subpath export exposes the `DetectorPlugin` type
  contract plus an `assertDetectorPlugin` runtime shape check.
- NER stages pipeline (`src/patterns/ner/stages/`) with tokenize,
  scriptClassify, prefixTrigger, dictionaryMatch, camelCaseSplit,
  nonLatinRun and aggregate as discrete, independently-testable stages.
  `detectNames` stays the stable public API and routes through the stages
  internally. Parity-tested against the existing NER fixtures.
- Layer 1 (secrets) and Layer 2 (identity) run through a
  `DetectorPlugin`-shaped internal interface. The `detectors:` config
  section is additive and lets operators disable individual built-in
  detectors (OrPostFilter-style). External plugin loading stays internal
  in 1.3; no separate npm package yet.
- StreamRehydrator goes through a `StreamFormat` interface (anthropic,
  openai). The format registry is internal for 1.3 but closes the
  hardcoded branch in the rehydrator so a Gemini/Cohere adapter is
  drop-in.
- `filters.custom_pins` and `detectors.custom_pins` pin custom modules to
  a SHA-256 digest. Pinned modules are rejected on content mismatch even
  when `trust.allow_unsigned_local: true`. The loaders now read the file
  once into memory, hash the buffer and feed the same bytes to `import()`
  via a data URL so a TOCTOU swap between hash-check and import cannot
  slip in an unpinned payload.
- `.checkpoint` sidecars are signed with the active HMAC kid when one is
  configured (`.checkpoint.hmac`). `seedFromCheckpoint` verifies the
  signature on startup before replaying seq/lastHash, so an attacker with
  one-shot write access to the audit dir cannot forge a chain anchor.
- Plugin-emitted detections are namespaced as `plugin:<id>:<type>` before
  the Layer 1/2 audit trail sees them, keeping built-in detector-id
  collisions and type-field spoofing out of the dashboard.
- `detectors.disable` matches both built-in type names and plugin ids, so
  `disable: [my-plugin]` silences every hit a given plugin emitted.
- `refreshHmacKeyring` logs a warning when a rotation resolves to an empty
  keyring, so an accidental export-leak does not silently disable HMAC
  signing.

### Changed

- `ainonymous doctor` now exits non-zero when `identity.company`,
  `identity.domains` or `identity.people` are empty. The new `--force`
  flag keeps the old permissive behaviour for setups that intentionally
  leave one field blank. Non-PII warnings still require `--strict` to
  fail the exit code. **CI migration note**: pipelines that ran
  `ainonymous doctor` as a pre-flight check against a deliberately
  minimal config (no company, no people list) will now fail. Add
  `--force` or populate the identity fields.
- `BENCHMARKS.md` gains a per-repo methodology table for the
  "medium cuts findings by ~95 %" number. The README claim now links to
  that section and the reproduction command.
- `web-tree-sitter` bumped from 0.20.8 to 0.25.10. Internal only;
  AST extraction surface and supported language list are unchanged.
- `ainonymous config migrate` preserves `filters`, `trust`, `detectors`
  and `behavior.streaming` sections through the rewrite.
- `Pipeline` resolves the OrPostFilter chain once on construction from
  built-ins + `filters.disable` + any trusted custom modules. The chain
  is exposed as a readonly array on `PipelineContext.orFilters`.
- The audit logger writes a JSON-encoded checkpoint alongside each
  JSONL file. On startup the chain logger seeds `seq` and `lastHash`
  from the checkpoint so the hash chain stays continuous across proxy
  restarts.
- The HMAC logger observes `SIGHUP` (POSIX) and re-reads
  `AINONYMOUS_AUDIT_HMAC_KEY*` env vars, so operators can rotate the
  active kid without a full restart.
- `StreamRehydrator.flush()` runs a final rehydrate pass over the
  leftover buffer before emitting it raw. Truncated SSE streams where a
  pseudonym landed in the last chunk now round-trip through the session
  map instead of leaking the pseudonym.
- `lastEagerBoundary` tracks boundaries incrementally over the growing
  buffer instead of re-scanning the full window on every push.
- `loadConfiguredCustomFilters` imports modules in parallel via
  `Promise.all`, so a `filters.custom: [a, b, c]` config no longer pays
  three sequential `import()` hits on cold start.
- `prepack` regenerates `sbom.cdx.json` via the pinned cyclonedx-npm
  version and refuses to publish when the SBOM is older than the most
  recent commit that touched `package.json` or `package-lock.json`.

## [1.2.2] - 2026-04-21

Hardening release covering Unicode bypass gaps, PII coverage under strict compliance presets, and release-pipeline safeguards against orphan Sigstore attestations.

### Fixed

- Unicode invisibles are now stripped by category match (`\p{Cf}`) instead of a hand-maintained range list. U+061C Arabic Letter Mark, U+180E Mongolian Vowel Separator, U+FFF9..FFFB Interlinear Annotation, U+115F/U+1160/U+3164/U+FFA0 Hangul zero-width fillers and U+034F Combining Grapheme Joiner are neutralised before pattern matching. Variation Selectors keep their explicit range check because they live in category `Mn` and a blanket `Mn` strip would remove legitimate combining marks.
- Expanded PII types under `compliance: hipaa | ccpa | finance | pci-dss` no longer collapse to `***ANONYMIZED***`. SSN, US/UK passport, US/UK driving licence, UK postcode, US ZIP, Canadian SIN, Australian TFN/Medicare, India Aadhaar/PAN, Brazilian CPF/CNPJ, Mexican CURP/RFC, South Korean RRN, South African ID, Hungarian tax/personal ID and Indonesian NIK each get deterministic counter-based pseudonyms that round-trip through rehydrate.
- `enablePersistence` now performs a probe write-and-delete on the audit directory at startup. Under `audit_failure: block` an unwritable directory throws at boot instead of returning 503 on every request.
- `audit pending` splits sentinel-only entries out of the rehydration-pending bucket. Originals mapped to `***ANONYMIZED***` cannot rehydrate by design; reporting them as indistinguishable from real misses hid a systemic data-loss class.

### Added

- `/metrics` now exposes `ainonymous_audit_chain_broken{file="..."}` (0/1 gauge per JSONL file) and `ainonymous_audit_chain_broken_total` (counter across files currently failing). Cron-driven `ainonymous audit verify` can alert through Prometheus without an additional sidecar.
- Proxy emits a single `audit_posture` log line at startup with `audit_log`, `audit_failure`, `audit_dir` and `compliance`. Operators see the effective mode without reading the config back.
- Release workflow runs `npm publish --dry-run` before the real publish and signs with Sigstore only after `npm publish` succeeds. A new `.githooks/pre-push` check blocks any tag push whose version does not match `package.json.version`. CI has a matching `Verify tag matches package.json version` gate. Structurally prevents the v1.2.1-style orphan Rekor entry.
- CI workflow runs the secret-diff scanner on pull requests and on the full tree on pushes, so external contributors without `make install-hooks` are still scanned.
- `OPERATIONS.md` adds a cron template and systemd timer for `ainonymous audit verify --strict`. `SECURITY.md` documents the 503 `audit_persist_failed` retry policy, clarifies that `audit verify` is a chain-consistency check (HMAC tamper-evidence tracked for v1.3), and publishes a known-orphan Rekor index for the v1.2.0 pre-publish signature.

### Changed

- Config validator rejects `compliance: gdpr | hipaa | pci-dss` combined with `audit_log: false`. The combination is internally contradictory; previously it was silently permitted.
- README CLI reference surfaces `doctor --strict`, `audit verify` (with exit codes) and `behavior.audit_failure`. Pin-version examples in README, OPERATIONS, SECURITY and THREAT_MODEL now point at `1.2.2`.

## [1.2.1] - 2026-04-19

Hotfix release addressing crashes, audit integrity, streaming robustness, and config validation found while evaluating v1.2.0 across ten real repositories.

### Fixed

- Constant pseudonym crash family. IPv6, MAC, date-of-birth, UK national insurance, German tax-id, NHS number, sozialversicherung, personalausweis no longer collapse to a single fixed pseudonym. PseudoGen now holds per-type counters and IPv6 pseudonyms live in the RFC 3849 documentation prefix. Each type can absorb at least 10k unique originals before wrap.
- Sentinel collision. Multiple originals mapping to `***ANONYMIZED***` or `***REDACTED***` no longer throw. The reverse map skips sentinels so a request with two unknown-PII hits completes cleanly.
- Stream rehydrator leftover buffer is now capped at 1 MB. Truncated SSE streams flush raw instead of growing unbounded.
- Proxy aborts the upstream request when the client disconnects mid-stream. Previously the upstream agent leaked a socket per aborted request.
- Audit tail TTY injection. Control characters in `context` payloads are stripped before display.
- Identity coverage in `doctor` reports per-field. An empty `people` list now warns even if `company` is set, instead of only warning when all three are empty.

### Added

- **`ainonymous audit verify` subcommand**. Walks `--dir`, verifies the SHA-256 hash chain across all JSONL files, and exits 0 on clean chains, 2 on a hash mismatch, 3 under `--strict` when a checkpoint sidecar is missing. `audit tail`, `audit pending`, and `audit export` now print a warn banner when the chain is broken.
- **`behavior.audit_failure: block | permit`** config key (default `permit`, defaults to `block` under `compliance: gdpr | hipaa | pci-dss`). On persist error under `block` the proxy returns HTTP 503 to the client instead of silently continuing with half-written audit state.
- Unicode stripping covers bidi overrides (U+202A..E, U+2066..9), tag characters (U+E0000..U+E007F), and variation selectors (U+FE00..U+FE0F). Mathematical Alphanumeric copies of ASCII letters are folded via NFKC per-codepoint. The pre-detection pipeline no longer leaks payloads that hide behind invisible codepoints.
- Config validator detects self-referencing YAML anchor cycles and fails early with a clear error path, preventing the downstream `JSON.stringify` crash.

### Changed

- `SECURITY.md` supported-versions matrix updated to `1.2.x`.
- `THREAT_MODEL.md` version header aligned with the release.

## [1.2.0] - 2026-04-19

Usability and real-world hardening after running the v1.1.3 scanner against nine internal repositories (Java/Spring, Kafka Connect, Python/FastAPI, React, Keycloak/MariaDB infra). The default is now optimized for LLM-readable output while keeping Layers 1+2 strict on secrets and PII.

### Fixed

- Dashboard URL with `?token=` query parameter now works. Previously the server matched `req.url` including the query string against `/dashboard`, so the URL the CLI prints at startup returned `{"error":"not_found"}`. Path and query are now separated before any route matching. `/shutdown?token=` is unchanged externally but the handler now reads the token from the raw URL instead of the stripped path.
- Dashboard subresource loading. `index.html` references `/dashboard/app.js` and `/dashboard/app.css` without a token, but both paths require mgmt auth. The dashboard HTML is now served with the current session's token injected into both subresource URLs, so browser navigation with `?token=` works end-to-end.

### Added

- **`behavior.aggression`** config key with three modes (semantics shifted mid-v1.2. see Behavior Change below):
  - `low`. identity + `domain_terms` compound/standalone replacement only. No AST identifier rewriting, no reverse-domain package-path rewrites. Closest to the pre-v1.2 medium.
  - `medium` (default). full AST-driven class/interface/method/field/type obfuscation, keyword + framework-annotation safety net, reverse-domain package-path rewrite, case-cascaded PascalCase/camelCase stems, plus the low-mode domain-term replacement.
  - `high`. medium plus formal-parameter pseudonymization. Phase 4 will add comment-scan for embedded domain terms.
    `code.sensitive_paths` files always run in `high` regardless of the global setting.
- **Code Obfuscator (v1.2 phases 1-3)**: new `src/ast/keywords.ts` with per-language keyword sets (Java, Kotlin, Python, TypeScript/JavaScript, Go, Rust, PHP, C#) and a `FRAMEWORK_ANNOTATIONS` set covering Spring, JPA, Lombok, Quarkus, Angular, NestJS, .NET, plus React-hook prefixes. Fixes a silent breakage where `package` → `Psi` in `aggression: high`, and brings cross-site consistency so `class FooService`, `FooService fooService`, and `import com.acme.FooService` all resolve to the same pseudo stem.
- NER pass 3 catches first+last name pairs embedded in camelCase / PascalCase identifiers (`customerPeterMueller` → flagged, `dataHansMueller` with asciified lookup → flagged).
- NER pass 4 detects standalone CJK, Korean, Japanese, Arabic, Hebrew, Cyrillic, Thai, and Devanagari name runs at lower confidence (0.55), previously only caught when preceded by `Author:` / `Kontakt:` / similar context markers.
- `ainonymous scan` default output is a histogram + top-files summary; `--verbose` keeps the old raw-dump behaviour. Files with ≥100 findings get a tuning hint.
- Auto-detect strips `(USER.NAME DOMAIN.TLD)`-style git author suffixes, collapses first-last/last-first duplicates, skips parent-POM BOM groupIds (spring-boot-starter-parent no longer ends up as the company name), derives `identity.domains` from Maven groupId when the git email is a noreply/free-provider address, and falls back to a `backend/` / `api/` subdir for language detection in monorepos.
- `FRAMEWORK_STOPLIST` in auto-detect grew by ~50 entries (kafka, confluent, connector, debezium, testcontainers, keycloak, mariadb, opentelemetry, …). generic framework words no longer end up in `code.domain_terms`.

### Behavior Change (BREAKING for config-pinned users)

- `behavior.aggression` semantics shifted in the v1.2 cycle after real-world testing with ticket #4913228 (a Spring Boot repo). The old `medium` protected identity/secrets but leaked class, method, package, and type names to the upstream LLM. v1.2 medium now runs the full AST obfuscator by default. Migration paths:
  - Users who want the pre-v1.2 medium behaviour back should set `behavior.aggression: low` explicitly.
  - Users who already had `aggression: high` retain the strictest mode; parameters are now additionally pseudonymized.
  - `ainonymous config migrate` prompts on upgrade when `aggression` is not explicitly set.

### Changed

- **Default `aggression` mode is `medium`**, now covering class/type/method/field obfuscation. not just compound domain-term rewrites as in the early-v1.2 iterations. Scans still favour readable output over false positives.
- Credit-card pattern accepts space/dash/dot/slash/colon/underscore/pipe separators **and** no separator at all, paired with a Luhn post-filter. Previous regex missed bare 16-digit card numbers in JSON and missed dot-separated cards in CRM exports.
- Phone pattern requires a country prefix (`+`, `00`) or a German mobile prefix (`015x` / `016x` / `017x`). Long digit sequences without any context no longer match. `UID 01234567890` used to fire as a phone hit.
- OpenRedaction integration now drops `phone`, `credit-card`, `person-name`, `name`, and `heroku-api-key` by default (local regex + local NER are stricter). Country-specific ID types (`ssn`, `australian-medicare`, `canadian-sin`, `india-aadhaar`, 11 more) are disabled by default and re-enabled by the matching `behavior.compliance` preset (`hipaa` → `ssn`/`driving-license-us`/`passport-us`; `pci-dss` / `finance` → `credit-card`).
- Code Layer's `preserve` list is now honored in **all four** replacement paths. `applyAstIdentifiers`, `applyCompoundDomainTerms`, `applyStandaloneDomainTerms`, and the cross-session rehydration loop. Previously it was only checked inside the AST identifier extraction, so a preserved compound could still be rewritten when any of its substrings matched a `domain_term`.
- `applyStandaloneDomainTerms` now compiles a single combined regex across all eligible terms instead of iterating per term with a full `text.replace`. Scales linearly with text size, no longer per-term × text size.

### Docs

- README Quick Start adds `ainonymous scan` as step 2 and documents the three aggression modes.
- `examples/before-after/` updated to reflect the medium-mode default.

### Tests

- `tests/unit/preserve-logic.test.ts`. regression coverage for all four code-layer replacement paths plus a non-preserve guard.
- `tests/unit/auto-detect.test.ts`. author-parens stripping, first-last/last-first dedup, framework-stoplist filtering, Maven groupId parent fallback, monorepo language fallback.
- NER tests cover camelCase-embedded names, non-latin context-prefix detection, standalone non-latin runs.

### Migration (action required for existing v1.1.x users)

Two behaviour shifts need an explicit decision before upgrading:

1. **`aggression: medium` default is weaker than v1.1.x.** v1.1.x implicitly rewrote every AST identifier; v1.2 only rewrites compound identifiers containing a `domain_term`. If your threat model requires the old behaviour, set `behavior.aggression: high` explicitly, or mark sensitive files via `code.sensitive_paths` (those always run in `high` regardless of the global setting). Identity and secret detection are unchanged.
2. **Compliance presets now re-enable jurisdiction-specific IDs that used to always drop.** A v1.1.x deployment with `compliance: hipaa` did not detect `ssn`, `driving-license-us`, or `passport-us` because those types were hard-disabled. v1.2 turns them back on for HIPAA/CCPA and turns `credit-card` back on for PCI-DSS/finance. If you relied on the old no-detection behaviour for internal reasons, add a custom filter or drop the `compliance:` key. Preset names are now matched case-insensitively (`HIPAA` and `hipaa` both work).
3. **Add `ainonymous audit pending` to existing workflows** to surface pseudonyms the LLM ignored or renamed. useful when the bidirectional map silently carries stale entries across long sessions.

## [1.1.3] - 2026-04-16

Security and backward-compat patch.

### Security

- `AINONYMOUS_MGMT_TOKEN` in environment is now length-checked. The proxy refuses to start when the env token is shorter than 16 characters, matching the policy already enforced on `behavior.mgmt_token` in config. Previously the env value bypassed the length check and a single-character token was accepted, leaving management endpoints brute-forceable on a non-local bind.

### Changed (backward-compat)

- `loadConfig` logs a warning when `.ainonymity.yml` (legacy filename) is present but `.ainonymous.yml` is missing. The legacy file is not loaded; behaviour matches the previous "no config found" path but the warning makes the silent default obvious after upgrading.
- `// @ainonymity:redact` annotations in source code are now honored with a deprecation warning in addition to the new `// @ainonymous:redact`. Without this, existing user codebases would have silently lost body-redaction after the rebrand.
- `.gitignore` extended with the legacy `ainonymity-audit/`, `ainonymity-session.db*` paths so upgraded checkouts don't accidentally commit pre-1.1.0 on-disk artefacts.

### Tests

- New assertion in the upstream error-body integration test: verifies that identity values (`Artur Sommer`, `Acme Corp`) and secrets (`hunter2secretpass`) never reach the upstream request body, not just that the client-side `***REDACTED***` marker is preserved.
- `examples/before-after/output.md` no longer claims `Partner` as pseudonymized (the demo input never contains it).

## [1.1.2] - 2026-04-16

Documentation-only patch. No runtime changes. Fixes version-staleness across docs after the v1.1.x rebrand series.

### Changed

- `CHANGELOG.md` now covers the 1.0.x and 1.1.x release trail.
- `README.md`, `OPERATIONS.md`, `SECURITY.md`, `THREAT_MODEL.md` reference the current version where previously pinned to `1.0.0`.
- `legal/DPA-template.md` TOM description acknowledges the opt-in `session.persist: true` mode (SQLite-backed AES-256-GCM store), instead of claiming that no persistence exists.
- Internal `v1.1 candidates` labels for deferred items (Unicode confusables, HMAC audit chain, per-regex timeout, pseudonym-replay guard, `ainonymous key rotate`, ISO 13616 IBAN regex) are now `v1.2 candidates`.

## [1.1.1] - 2026-04-16

Branding-consistency patch. No behavior change.

### Changed

- Renamed internal identifiers that the earlier rebrand pass missed: `AInonymityConfig` TypeScript type is now `AInonymousConfig`, Prometheus metric names are now `ainonymous_*` (previously `ainonymity_*`), `src/index.ts` re-exports are aligned.

## [1.1.0] - 2026-04-16

**Breaking: renamed from `ainonymity` to `ainonymous`.** All user-facing identifiers changed: npm package name, CLI binary, config filename, environment variables, token / session DB / audit paths, HTTP realm, brand string. Earlier `ainonymity@*` publishes have been unpublished; the npm name is permanently retired.

### Changed

- npm package: `ainonymity` → `ainonymous`.
- CLI binary: `ainonymity` → `ainonymous`.
- Config filename: `.ainonymity.yml` → `.ainonymous.yml`.
- Environment variables: `AINONYMITY_MGMT_TOKEN` → `AINONYMOUS_MGMT_TOKEN`, `AINONYMITY_SESSION_KEY` → `AINONYMOUS_SESSION_KEY`, `AINONYMITY_HOST` → `AINONYMOUS_HOST`, `AINONYMITY_UPSTREAM_*` → `AINONYMOUS_UPSTREAM_*`.
- Default audit directory: `./ainonymity-audit/` → `./ainonymous-audit/`.
- Default session DB: `./ainonymity-session.db` → `./ainonymous-session.db`.
- Token paths: `$TMPDIR/ainonymity-<port>.token` → `$TMPDIR/ainonymous-<port>.token` (POSIX); `%USERPROFILE%\.ainonymity\` → `%USERPROFILE%\.ainonymous\` (Windows).
- HTTP bearer realm: `ainonymity` → `ainonymous`.
- Brand string `AInonymity` → `AInonymous`.
- Demo data in `examples/before-after/` and `tests/integration/proxy-e2e.test.ts` is now fictional (`Acme Corp`, `CustomerDB`, `Kay Example`) instead of identifying a specific third party.

### Migration

- Rename `.ainonymity.yml` to `.ainonymous.yml` (same schema, no content change required).
- Rename any `AINONYMITY_*` environment variables in your deployment manifests to `AINONYMOUS_*`.
- Rename `@ainonymity:redact` source-code annotations to `@ainonymous:redact`.
- Prometheus scrape configs consuming `ainonymity_*` counters must switch to `ainonymous_*`.
- The `ainonymity-audit/` directory on disk is not read by the new binary; move or archive it. New audit files land in `ainonymous-audit/`.
- Pseudonyms persisted in an old `ainonymity-session.db` are not imported automatically; start fresh with `ainonymous-session.db`.

## [1.0.0] - 2026-04-16

Initial public release.

### Added

- Three-layer anonymization pipeline (secrets, identity, code semantics).
- Local HTTP proxy with SSE-aware rehydration for Anthropic and OpenAI API formats.
- AST-based identifier extraction via Tree-sitter WASM for TypeScript, JavaScript, Java, Kotlin, Python, PHP, Go, Rust, and C#.
- OpenRedaction integration with selectable compliance presets (`gdpr`, `hipaa`, `pci-dss`, `ccpa`, `finance`, `healthcare`).
- AES-256-GCM encrypted session map with key rotation, lazy decrypt cache.
- Optional session map persistence via built-in `node:sqlite` (requires Node.js 22.5+).
- Bearer-token authentication on management endpoints (`/metrics`, `/dashboard`, `/events`, dashboard assets).
- Audit log as SHA-256 hash chain with SIEM-friendly JSONL output.
- Live dashboard with strict CSP (no `'unsafe-inline'`), SSE event stream.
- CLI commands: `start`, `stop`, `status`, `init`, `scan`, `audit`, `glossary`, `hooks`, plus wrapper mode (`ainonymous -- <tool>`).
- Unicode normalization (NFKC + zero-width-character strip) to defeat ZWJ and fullwidth bypass attacks on pattern detection.
- HTTP header anonymization with passthrough list for auth and provider-specific headers.
- Signed releases via Sigstore keyless signing and npm provenance.

### Known limitations

- Unicode confusables (e.g. Cyrillic `а` vs Latin `a`) are not unified. Tracked as v1.2 item.
- Audit log chain is SHA-256, not HMAC. Tamper-evident against external readers; an insider with write access to the audit directory can forge the tail.
- Session map is unbounded (no LRU / TTL).
- Pseudonym broadcast on `/events` reveals live mapping names to any subscriber authenticated with the mgmt token.
- User-supplied `secrets.patterns` regexes have no complexity gate and can backtrack catastrophically.

See `THREAT_MODEL.md` for the full residual-risk analysis.
