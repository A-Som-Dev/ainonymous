# AInonymity

[![CI](https://github.com/A-Som-Dev/ainonymity/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/A-Som-Dev/ainonymity/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ainonymous.svg)](https://www.npmjs.com/package/ainonymous)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg)](package.json)

Local proxy that anonymizes sensitive data before it reaches LLM APIs.

```bash
npm install -g ainonymous
ainonymous -- claude   # wraps any tool that respects ANTHROPIC_BASE_URL / OPENAI_BASE_URL
```

Requires Node.js 22.5+. Releases are signed with Sigstore (npm provenance). See [Install](#install) for `npx`, `from source`, and verification.

## Why?

Most companies ban AI coding tools because every prompt ships source code, API keys, and internal domain names straight to third-party servers. AInonymity sits between your AI tool and the API. It rewrites outgoing requests so the LLM never sees the real data, then maps responses back to the originals before they hit your editor.

## What it looks like

```
  Your code                              What the LLM sees

  class CustomerService {                class AlphaService {
    private apiUrl =                       private apiUrl =
      "https://api.asom.internal";           "https://api.alpha-corp.internal";
    password = "hunter2";                  password = ***REDACTED***;
  }                                      }
```

Secrets get redacted permanently. Names, domains, and identifiers get consistent pseudonyms that reverse automatically in responses.

A full round-trip on a realistic Spring Boot prompt is in [`examples/before-after/`](examples/before-after/). Performance on a laptop-class CPU: ~100 ms p50 anonymize (dominated by Tree-sitter WASM parse cost), single-digit ms rehydration. See [BENCHMARKS.md](BENCHMARKS.md) for measured p50/p95 values.

## Install

```bash
npm install -g ainonymous
# or run without installing
npx ainonymous
```

Requires Node.js 22.5+.

Releases are signed with Sigstore (keyless, via GitHub Actions OIDC) and npm publishes carry a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements). See [SECURITY.md](SECURITY.md#verifying-release-artifacts) if you want to verify a downloaded tarball or the installed package.

### From source

```bash
git clone https://github.com/A-Som-Dev/ainonymity.git
cd ainonymity
npm install
npm run build
node dist/cli/index.js --help

# Or link globally for `ainonymous` in your PATH:
npm link
```

## Quick start

```bash
# 1. Generate a .ainonymity.yml config for your project (scans git log, detects
#    company/domains/people from git config + commit authors)
ainonymous init

# 2a. Wrap an AI tool - the proxy starts, sets ANTHROPIC_BASE_URL /
#     OPENAI_BASE_URL for the child process, and shuts down when the tool exits.
#     Requires the tool (claude, cursor, aider, cody, continue) to already be
#     installed on your PATH.
ainonymous -- claude

# 2b. Or run the proxy standalone and test it with curl before wiring an editor:
ainonymous start &
curl -sS http://localhost:8100/health
curl -sS -X POST http://localhost:8100/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-latest","max_tokens":64,"messages":[{"role":"user","content":"Rename CustomerService to something generic"}]}'
ainonymous audit tail   # see what got replaced on the outgoing request
ainonymous stop
```

See [`examples/before-after/`](examples/before-after/) for full Java/Python/Go round-trip demos (`-before.*` = your source, `-after.*` = what the upstream LLM saw).

## How it works

Three pipeline layers run in order on every outgoing request:

1. **Secrets**: ~30 built-in regex patterns (API keys, passwords, tokens, connection strings) plus the full OpenRedaction ruleset. Replaced with `***REDACTED***` (never reversed).
2. **Identity**: Company names, domains, email addresses, and people get consistent pseudonyms. OpenRedaction detection presets (GDPR, HIPAA, CCPA, PCI-DSS) can be selected via `compliance:` to prioritize region-specific data types. `asom.de` always becomes the same fake domain within a session. Person-name detection uses a dictionary (see `src/patterns/ner.ts`) that covers DE/EN/TR/AR/PL/IT/IN well and is sparse for CJK, Scandinavian, and Middle Eastern names — add uncommon names explicitly via `identity.people` in the config.
3. **Code semantics**: Tree-sitter parses your source code and renames domain-specific identifiers (class names, method names, top-level variables) to generic alternatives. Coverage is best for TypeScript/JavaScript; Python, Java, Kotlin, Go, Rust, PHP, and C# have basic support via language-specific AST queries.

Responses flow back through the pipeline in reverse, restoring all pseudonyms to their originals. Secrets stay redacted.

## Compared to alternatives

| Tool | Runs where | Rehydrates responses | LLM-proxy mode | Code-aware |
|------|-----------|----------------------|----------------|-----------|
| **AInonymity** | Local (your machine) | Yes (bidirectional) | Native HTTP proxy | Tree-sitter for 8 languages |
| [Microsoft Presidio](https://github.com/microsoft/presidio) | Library / API | No (one-way redaction) | No | No |
| [Lakera Guard](https://www.lakera.ai/) | Remote SaaS | No | No (input-filter for Lakera-hosted) | No |
| [PromptGuard-style filters](https://huggingface.co/meta-llama/Prompt-Guard-86M) | Local model | No | Input classifier | No |
| Manual regex scrub | Anywhere | No | No | No |

AInonymity's niche: it's the only option that lets the LLM *see* consistent pseudonyms and maps its response back to the originals so your editor sees the real names. That makes refactoring suggestions, rename operations, and code reviews still usable, while keeping actual identifiers off third-party servers.

## Configuration

`ainonymous init` generates a `.ainonymity.yml` tailored to your project. Edit it to add your specifics:

```yaml
version: 1
secrets:
  patterns:
    - name: stripe-key
      regex: "sk_live_[A-Za-z0-9]{24,}"

identity:
  company: "Asom GmbH"
  domains: ["asom.de", "asom.internal"]
  people: ["Artur Sommer", "Bob Manager"]

code:
  language: typescript
  domain_terms: ["CustomerOrder", "InvoiceService"]   # YOUR identifiers - get pseudonymized
  preserve: ["React", "Express", "useState"]           # public libraries - stay untouched
  sensitive_paths: [".env", ".env.*", "**/*.pem"]  # glob paths, scan mode only
  redact_bodies: ["**/internal/**", "**/secrets/**"]  # glob paths, scan mode only — use // @ainonymity:redact at proxy time

behavior:
  interactive: true
  audit_log: true
  audit_dir: ./ainonymity-audit  # JSONL logs for SIEM integration
  dashboard: true
  port: 8100
  compliance: gdpr  # or hipaa, ccpa, pci-dss, finance, healthcare
  # mgmt_token: ""  # leave unset for localhost-only; generate with `openssl rand -hex 32`
                    # when binding to 0.0.0.0 (Docker, shared host). Required >= 16 chars.
  upstream:
    anthropic: https://api.anthropic.com
    openai: https://api.openai.com

session:
  persist: false                      # opt-in: keep pseudonyms across restarts
  persist_path: "./ainonymity-session.db"  # SQLite file, ciphertext only
```

Session persistence is off by default. When enabled, the in-memory bimap is mirrored to an AES-256-GCM-encrypted SQLite file so that in-flight LLM responses still rehydrate correctly after a proxy restart. Requires Node.js 22.5+ (uses built-in `node:sqlite`, no native build). Provide a stable key via `AINONYMITY_SESSION_KEY` (base64, 32 bytes) to keep the DB readable across processes — without it the DB is effectively wiped on every fresh start. See [SECURITY.md](SECURITY.md#session-map-persistence-opt-in) for the confidentiality model.

### domain_terms vs. preserve

Both lists affect Layer 3 (code semantics) but in opposite directions:

| List | Effect | Example |
|------|--------|---------|
| `domain_terms` | **Your** business concepts. Get pseudonymized to Greek-alphabet generics. | `CustomerLoyalty` → `AlphaService` |
| `preserve` | **Public** library / framework names. Stay untouched so the LLM recognizes them. | `Express`, `useState`, `Spring` stay as-is |

Rule of thumb: if Google's top 10 results for a term are your company's internal docs, it belongs in `domain_terms`. If they're public documentation, it belongs in `preserve`.

### Compliance presets

`behavior.compliance` selects which OpenRedaction detection pack gets prioritized:

| Preset | Focus | Added patterns |
|--------|-------|----------------|
| `gdpr` | EU data protection | Names, addresses, national IDs (de, fr, es, it), SEPA IBANs, EU phone numbers |
| `hipaa` | US healthcare | SSN, MRN, NPI, ICD codes, US addresses, Medicare numbers |
| `pci-dss` | Payment cards | PAN with Luhn check, CVV hints, bank-account formats |
| `ccpa` | California consumer | Driver's license, consumer identifiers |
| `finance` | Banking / trading | SWIFT/BIC, IBAN (global), brokerage account IDs |
| `healthcare` | Broader clinical | Patient IDs, clinical note signatures, dosage mentions |

**Compliance is not certification.** These presets help you detect *likely* sensitive data — they do not make your use of an LLM regulator-approved. Verify with your DSB / DPO / compliance officer.

### Management endpoint auth

By default the proxy binds to `127.0.0.1` and `/metrics`, `/metrics/json`, `/dashboard`, and `/events` are reachable without a token. If you bind to a non-local interface (e.g. `AINONYMITY_HOST=0.0.0.0` in a container), set a bearer token so these endpoints are not exposed:

```bash
export AINONYMITY_MGMT_TOKEN="$(openssl rand -hex 24)"
curl -H "Authorization: Bearer $AINONYMITY_MGMT_TOKEN" http://localhost:8100/metrics
```

`AINONYMITY_MGMT_TOKEN` overrides the `behavior.mgmt_token` config key. The token must be at least 16 characters. `/health` and `/v1/*` are never gated — health checks stay scrape-friendly and the API path is authenticated upstream.

Browsers cannot attach `Authorization` headers to `<link>` / `<script>` / `EventSource` requests, so when a token is set the HTML dashboard at `/dashboard` is effectively headless-only (curl, CI scrapers). Put a reverse proxy in front if you need browser access on a non-local bind — see `SECURITY.md` → "Dashboard access when a mgmt token is set".

## CLI reference

| Command | Description |
|---------|-------------|
| `ainonymous init` | Scan project, generate `.ainonymity.yml` |
| `ainonymous start` | Start the proxy server |
| `ainonymous stop` | Stop the running proxy |
| `ainonymous status` | Check if proxy is running |
| `ainonymous scan` | Dry run: show what would be anonymized |
| `ainonymous audit tail` | Show last 20 audit log entries |
| `ainonymous audit export` | Export logs as consolidated JSON (SIEM-ready) |
| `ainonymous glossary add <term>` | Add a domain term to config |
| `ainonymous glossary list` | List configured domain terms |
| `ainonymous glossary suggest` | Suggest new terms from project scan |
| `ainonymous hooks install` | Install Claude Code hooks |
| `ainonymous hooks show` | Show hook configuration |
| `ainonymous -- <tool>` | Wrap a tool (auto-start proxy, set env, cleanup) |

## Supported tools

Works with any tool that respects `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`:

- **Claude Code**: `ainonymous -- claude` (Anthropic API)
- **Cursor**: `ainonymous -- cursor` (OpenAI-compatible API)
- **Aider**: `ainonymous -- aider` (both APIs)
- **Cody**: `ainonymous -- cody` (both APIs)
- **Continue**: `ainonymous -- continue` (OpenAI-compatible API)

The proxy auto-detects the API format per request:
- `POST /v1/messages`: Anthropic format, forwarded to `https://api.anthropic.com`
- `POST /v1/chat/completions`: OpenAI format, forwarded to `https://api.openai.com`

Both formats go through the same anonymization pipeline.

Other tools can use the proxy manually by pointing their base URL to `http://localhost:8100`.

## Programmatic API

```typescript
import { Pipeline, loadConfig } from 'ainonymous';

const config = loadConfig(process.cwd());
const pipeline = new Pipeline(config);

const result = await pipeline.anonymize(sourceCode);
console.log(result.text);          // anonymized output
console.log(result.replacements);  // what was changed
```

## Limitations

AInonymity reduces the risk of leaking sensitive data but **does not guarantee complete anonymization**. Keep these limits in mind:

- Regex-based detection has structural limits. Unusual formats, obfuscated data, or context-dependent PII may slip through.
- AST-based code semantics currently supports TypeScript, JavaScript, Java, Python, PHP, and Kotlin. Other languages fall back to domain-term replacement.
- Compliance presets (GDPR, HIPAA, etc.) provide detection patterns for common data types. **Using these presets does not make your organization compliant** with any regulation.
- The tool is not a substitute for a professional security audit or legal review.
- Streaming responses are rehydrated via a per-content-block sliding buffer that reassembles pseudonyms split across SSE event boundaries (e.g. `Alpha` | `Corp` | `Service`). The buffer sizes itself from the current session map's longest pseudonym, so the first visible text is delayed by roughly that many characters.

You are responsible for reviewing what gets sent to LLM APIs. Use `ainonymous scan` to preview what would be anonymized before relying on the proxy.

## Troubleshooting

**Port 8100 already in use**
Another ainonymity instance is probably still running. `ainonymous status` shows it; `ainonymous stop` terminates it. If that fails, the shutdown token file lives under `$TMPDIR/ainonymity-8100.token` (POSIX) or `%USERPROFILE%\.ainonymity\ainonymity-8100.token` (Windows) — delete it and `pkill -f ainonymity` / `taskkill`.

**Claude Code / Cursor not picking up the proxy**
The wrapper mode (`ainonymous -- claude`) sets `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` for the child process only. If the tool reads its URL from a different env var or a config file, set that explicitly. `claude config set base_url http://localhost:8100` works for Claude Code.

**Dashboard shows no events**
Check that `behavior.dashboard: true` in your `.ainonymity.yml`, that the browser is on the same machine, and that you open the `/dashboard` URL (not `/`). With a `mgmt_token` set, browsers cannot authenticate — use a reverse proxy or access via `curl -H "Authorization: Bearer ..."`.

**Config got garbled after editing**
`ainonymous scan` walks the project and shows what would be anonymized — it also surfaces YAML parse errors immediately. If your `.ainonymity.yml` is broken, the proxy refuses to start and points to the offending line. There is no built-in backup; keep the file in version control.

**Windows: shutdown token at `$TMPDIR` not found**
AInonymity on Windows writes to `%USERPROFILE%\.ainonymity\` instead of `%TEMP%` to ensure per-user ACL isolation. If you have scripts that assume `$TMPDIR`, update them to check both paths, or export `USERPROFILE` explicitly.

**Tree-sitter WASM fails to load on arm64**
`tree-sitter-wasms` ships prebuilt WASM for common triples. If your platform is unusual, the first `anonymize()` call will surface a load error with the exact path. File an issue with `uname -a` + the error.

## For security and compliance teams

If you're evaluating AInonymity on behalf of a security / privacy / legal organization rather than as an individual developer, these are the artefacts you probably want to read:

| Document | What it covers |
|----------|----------------|
| [THREAT_MODEL.md](THREAT_MODEL.md) | STRIDE + LINDDUN analysis of the proxy, session map, audit log, dashboard, CLI. Explicit residual risks (R1-R5), adversary classes, trust boundaries. |
| [SECURITY.md](SECURITY.md) | Responsible disclosure, security design (AES-256-GCM session map, CSP, timing-safe compares, Unicode normalization, Sigstore verification commands, session-persistence confidentiality model). |
| [BENCHMARKS.md](BENCHMARKS.md) | Measured p50/p95 anonymize and rehydrate latency, methodology, what is *not* measured. |
| [OPERATIONS.md](OPERATIONS.md) | Deployment (systemd hardened unit, Kubernetes NetworkPolicy), monitoring, incident response, audit log retention, capacity planning. |
| [legal/DPA-template.md](legal/DPA-template.md) | Auftragsverarbeitungsvertrag (AVV) / Data Processing Agreement starter, bilingual disclaimer. Covers the two scenarios where a DPA is actually needed around AInonymity. |
| [legal/Art30-GDPR-template.md](legal/Art30-GDPR-template.md) | Verzeichnis von Verarbeitungstätigkeiten nach Art. 30 DSGVO template with worked example. |

Telemetry: AInonymity does not send any data anywhere except the configured upstream LLM endpoint. There is no phone-home, no usage tracking, no error-reporting service. You can verify with `tcpdump` on `lo0`/`eth0` during a session - the only outbound connection is HTTPS to `api.anthropic.com` / `api.openai.com` (or the upstream you configured).

Maintenance model: solo-maintained, MIT-licensed, responses best-effort (see SECURITY.md). For enterprise adoption consider pinning the exact version (`"ainonymous": "1.0.1"`, not `^`) and verifying Sigstore signatures on every upgrade. Commercial support is not part of this repository - see the "About" section at the bottom for contact.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run `make check` (TypeScript + ESLint)
4. Run `make test`
5. Open a PR

By submitting a pull request, you agree that your contribution is licensed under the MIT license.

## About

AInonymity is a solo-maintained project by [A-Som-Dev](https://github.com/A-Som-Dev), a freelance software engineer working on privacy-preserving tooling for companies that want to adopt AI assistants without handing sensitive source code to third parties. The tool was built for a concrete enterprise use case and open-sourced so that others facing the same problem can benefit.

If you find AInonymity useful in a commercial context, consider reaching out for consulting, integration help, or custom detection-rule packs for your industry.

## License

MIT
