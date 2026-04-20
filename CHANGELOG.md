# Changelog

All notable changes to AInonymous are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/).

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
