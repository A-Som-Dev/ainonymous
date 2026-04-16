# Changelog

All notable changes to AInonymity are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/).

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
- Unicode confusables (e.g. Cyrillic `а` vs Latin `a`) are not unified. Tracked as v1.1 item.
- Audit log chain is SHA-256, not HMAC. Tamper-evident against external readers; an insider with write access to the audit directory can forge the tail.
- Session map is unbounded (no LRU / TTL).
- Pseudonym broadcast on `/events` reveals live mapping names to any subscriber authenticated with the mgmt token.
- User-supplied `secrets.patterns` regexes have no complexity gate and can backtrack catastrophically.

See `THREAT_MODEL.md` for the full residual-risk analysis.
