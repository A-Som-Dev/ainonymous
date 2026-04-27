# AInonymous

[![CI](https://github.com/A-Som-Dev/ainonymous/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/A-Som-Dev/ainonymous/actions/workflows/ci.yml)
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

Most companies ban AI coding tools because every prompt ships source code, API keys, and internal domain names straight to third-party servers. AInonymous sits between your AI tool and the API. It rewrites outgoing requests so the LLM never sees the real data, then maps responses back to the originals before they hit your editor.

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

## New in 1.3

- **Detection-side Unicode hardening.** Latin / Cyrillic / Greek confusables
  fold to their ASCII baseline before glossary and secret matching.
  Cross-codepoint NFKC (Hangul L+V jamo, CJK compatibility, combining marks)
  now normalises correctly, and rehydration strips the width-zero + format
  character set so pseudonyms split by ZWJ / ZWNJ / CGJ still resolve.
- **Filter framework** (`filters:` + `trust:` config sections). Disable
  built-in OrPostFilters or plug in project-local `.mjs` filters. Custom
  modules only load when `trust.allow_unsigned_local: true` is explicitly
  set, and `filters.custom_pins` pins a SHA-256 per file so a trusted module
  cannot be silently swapped. See `docs/examples/custom-filter.mjs` for a
  hello-world template and
  [`SECURITY.md#custom-filter-trust-model`](SECURITY.md#custom-filter-trust-model)
  for the risk model.
- **`ainonymous preview`** runs the whole anonymization pipeline offline on a
  file or stdin with no network and no audit persistence. Use it to verify
  what an outbound request would carry before booking the API call.
  `--json` strips originals from the output so pipeline transcripts stay
  safe to archive. Preview does not persist audit entries, so it is a
  development tool rather than a processing record for production PII.
- **`ainonymous filters list` / `filters validate`** inspect the effective
  chain and dry-run custom filter shape checks.
- **`behavior.streaming.eager_flush`** is an opt-in streaming mode that
  releases buffered text at sentence or newline boundaries. Trade-off: a
  pseudonym that spans a boundary inside the sliding window can leak through
  unrehydrated. The implementation guards known pseudonym shapes (dots in
  IPv4, colons in IPv6, address separators), but operators accepting this
  flag should treat the false-negative risk as part of their accountability
  model.
- **HMAC keyring for audit sidecars** (`AINONYMOUS_AUDIT_HMAC_KEY_<KID>` +
  `AINONYMOUS_AUDIT_HMAC_ACTIVE_KID`). Rotate without losing verifiability
  for historical logs. POSIX builds pick up env changes on `SIGHUP` so
  rotation no longer requires a full restart. Vault / Azure Key Vault /
  AWS Secrets Manager examples in [OPERATIONS.md](OPERATIONS.md#audit-hmac).
- **Cross-session audit chain** persists through proxy restarts. The
  logger seeds `seq` and `lastHash` from the on-disk checkpoint, so the
  chain is continuous over the whole day's file rather than resetting on
  every restart.
- **NER stages pipeline** (`src/patterns/ner/stages/`) and internal
  `DetectorPlugin` interface for Layer 1 and Layer 2 detectors. Both are
  refactors behind the existing public APIs; `detectNames` stays the
  stable entry point. External plugin loading stays internal in 1.3.
- **`ainonymous/plugin-api`** subpath export ships the `DetectorPlugin`
  type and a runtime `assertDetectorPlugin` shape check.
- **Auto-detect** reads `pyproject.toml`, `setup.py`, the README H1 line,
  and `git remote get-url origin` so alternate project aliases stop
  leaking upstream.

## New in 1.2

- **`behavior.aggression`** (`low` / `medium` / `high`). how strict Layer 3 rewrites AST identifiers. Default is `medium`, which cut findings by ~95 % on our real-repo scans without weakening secret or identity detection. See [`examples/before-after/aggression-comparison.md`](examples/before-after/aggression-comparison.md) for side-by-side output and [`BENCHMARKS.md`](BENCHMARKS.md#finding-rate-medium-vs-high-aggression) for methodology and per-repo numbers.
- OpenRedaction `phone`, `credit-card`, `person-name`, `heroku-api-key` are **off by default**. local regex + NER matched more precisely. Compliance presets re-enable country-specific IDs (HIPAA: SSN + Medicare; PCI-DSS: PAN; …).
- Phone detection requires a `+` / `00` / German mobile prefix. Credit-card detection is Luhn-checked across every separator (space / dash / dot / slash / colon / underscore / pipe / none).
- NER now catches first+last name pairs embedded in camelCase (`customerPeterMueller`) and standalone CJK / Korean / Japanese / Arabic / Hebrew / Cyrillic / Thai / Devanagari name runs.
- `ainonymous scan` output is now a histogram + top-files summary with a tuning hint for files with ≥100 findings. `--verbose` keeps the old raw dump.
- Auto-detect strips `(USER.NAME DOMAIN.TLD)` git-author suffixes, dedupes first-last/last-first, skips parent-POM groupIds, and ships with ~50 more framework stopwords (Kafka, Debezium, Testcontainers, Keycloak, MariaDB, OpenTelemetry, …).

Migration from pre-v1.2: the `aggression` scale shifted in the v1.2 cycle. Old `medium` (compound-only) is now called `low`. New `medium` is the Code Obfuscator (AST + package-paths + keyword/framework safety). Run `ainonymous config migrate` on upgrade. it prompts when `aggression` isn't pinned. Full [CHANGELOG.md](CHANGELOG.md).

## Install

```bash
npm install -g ainonymous
# or run without installing
npx ainonymous
```

Requires Node.js 22.5+.

Releases are signed with Sigstore (keyless, via GitHub Actions OIDC) and npm publishes carry a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements). See [SECURITY.md](SECURITY.md#verifying-release-artifacts) if you want to verify a downloaded tarball or the installed package.

### Windows setup

`npm install -g ainonymous` and the CLI work the same on Windows. A few
paths and service-wrapper details differ from the POSIX defaults:

- Config, shutdown token and audit log live under `%USERPROFILE%\.ainonymous\`
  instead of `$TMPDIR` so per-user ACLs apply automatically.
- Use PowerShell for environment variables: `$Env:ANTHROPIC_BASE_URL =
  "http://localhost:8100"` instead of `export`.
- For a background service, wrap the CLI with [`nssm`](https://nssm.cc/):
  `nssm install ainonymous "C:\Program Files\nodejs\node.exe"
  "C:\path\to\ainonymous\dist\cli\index.js" start`. Set the working
  directory to the project root that holds `.ainonymous.yml`.
- `make` is not required. The CLI itself provides `ainonymous scan`,
  `ainonymous doctor` etc. The `make` targets in this repo are for
  contributors only.

See [OPERATIONS.md](OPERATIONS.md) for the full deployment runbook
(systemd is the reference there, but most hardening items apply equally
on Windows as Service Properties / NTFS ACLs).

### From source

```bash
git clone https://github.com/A-Som-Dev/ainonymous.git
cd ainonymous
npm install
npm run build
node dist/cli/index.js --help

# Or link globally for `ainonymous` in your PATH:
npm link
```

## Quick start

```bash
# 0. Preview the generated config without touching your repo.
ainonymous init --show
```

Example output:

```yaml
version: 1
identity:
  company: acme-corp
  domains:
    - acme-corp.de
  people:
    - Artur Sommer
    - Sally Müller
code:
  language: python
  domain_terms:
    - ReportHub
  preserve: []
behavior:
  aggression: medium
  port: 8100
```

```bash
# 1. Write it for real.
ainonymous init
```

The `init` output now also warns when auto-detect could not populate
`identity.company / domains / people` (solo repos with noreply git emails are
a typical case. you must fill those fields manually or Layer 2 runs idle
for person/company tokens):

```
WARN: auto-detect could not populate identity.company / domains / people.
      Open .ainonymous.yml and fill these fields. Layer 2 otherwise runs
      idle for person/company tokens and genuine PII will leak upstream.
```

```bash
# 2. Sanity-check your env (node version, port availability, config validity).
ainonymous doctor

# Sample output:
#   ✔  node version       v22.5.0
#   ✔  .ainonymous.yml
#   ✔  identity coverage  company=acme-corp domains=1 people=4
#   ✔  port 8100          free
#   ✔  upstream override  defaults
#   All checks passed. Run `ainonymous start --open` to begin.

# 3. Scan and see exactly what would get pseudonymised before you ever run
#    a real LLM request. --preview 3 shows the before/after of the first
#    three files with findings, not just the histogram.
ainonymous scan --preview 3

# Or keep the aggregated view (histogram + top files, the default):
ainonymous scan

# 4. Start the proxy and open the dashboard in your default browser.
ainonymous start --open

# 5a. Wrap an AI tool. the proxy starts, sets ANTHROPIC_BASE_URL /
#     OPENAI_BASE_URL for the child process, and shuts down when the tool
#     exits. Requires the tool (claude, cursor, aider, cody, continue) on
#     your PATH.
ainonymous -- claude

# 5b. Or run the proxy standalone and test it with curl. `$ANTHROPIC_API_KEY`
#     is your own Anthropic key (console.anthropic.com -> API Keys); the proxy
#     forwards it untouched to api.anthropic.com. For a pure pipeline smoke
#     test without hitting Anthropic, use `/health` only; the `/v1/messages`
#     call below will 401 with a dummy key because the upstream rejects it.
ainonymous start &
curl -sS http://localhost:8100/health
curl -sS -X POST http://localhost:8100/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-latest","max_tokens":64,"messages":[{"role":"user","content":"Rename CustomerService to something generic"}]}'
ainonymous audit tail   # see what got replaced on the outgoing request
ainonymous audit pending # see pseudonyms the LLM never referenced
ainonymous stop
```

See [`examples/before-after/`](examples/before-after/) for full Java/Python/Go round-trip demos (`-before.*` = your source, `-after.*` = what the upstream LLM saw).

## How it works

Three pipeline layers run in order on every outgoing request:

1. **Secrets**: ~30 built-in regex patterns (API keys, passwords, tokens, connection strings) plus the full OpenRedaction ruleset. Replaced with `***REDACTED***` (never reversed).
2. **Identity**: Company names, domains, email addresses, and people get consistent pseudonyms. OpenRedaction detection presets (GDPR, HIPAA, CCPA, PCI-DSS) can be selected via `compliance:` to prioritize region-specific data types. `asom.de` always becomes the same fake domain within a session. Person-name detection uses a dictionary (see `src/patterns/ner.ts`) that covers DE/EN/TR/AR/PL/IT/IN well and is sparse for CJK, Scandinavian, and Middle Eastern names. add uncommon names explicitly via `identity.people` in the config.
3. **Code semantics**: Tree-sitter parses your source code and renames domain-specific identifiers (class names, method names, top-level variables) to generic alternatives. Coverage is best for TypeScript/JavaScript; Python, Java, Kotlin, Go, Rust, PHP, and C# have basic support via language-specific AST queries.

Responses flow back through the pipeline in reverse, restoring all pseudonyms to their originals. Secrets stay redacted.

## Compared to alternatives

| Tool | Runs where | Rehydrates responses | LLM-proxy mode | Code-aware |
|------|-----------|----------------------|----------------|-----------|
| **AInonymous** | Local (your machine) | Yes (bidirectional) | Native HTTP proxy | Tree-sitter for 9 languages |
| [Microsoft Presidio](https://github.com/microsoft/presidio) | Library / API | No (one-way redaction) | No | No |
| [Lakera Guard](https://www.lakera.ai/) | Remote SaaS | No | No (input-filter for Lakera-hosted) | No |
| [PromptGuard-style filters](https://huggingface.co/meta-llama/Prompt-Guard-86M) | Local model | No | Input classifier | No |
| Manual regex scrub | Anywhere | No | No | No |

AInonymous's niche: it's the only option that lets the LLM *see* consistent pseudonyms and maps its response back to the originals so your editor sees the real names. That makes refactoring suggestions, rename operations, and code reviews still usable, while keeping actual identifiers off third-party servers.

## Configuration

`ainonymous init` generates a `.ainonymous.yml` tailored to your project. Edit it to add your specifics:

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
  redact_bodies: ["**/internal/**", "**/secrets/**"]  # glob paths, scan mode only. use // @ainonymous:redact at proxy time

behavior:
  interactive: true
  audit_log: true
  audit_dir: ./ainonymous-audit  # JSONL logs for SIEM integration
  audit_failure: permit  # block | permit. block returns 503 on persist failure
                         # (default under compliance: gdpr/hipaa/pci-dss);
                         # permit logs a warning and continues.
  dashboard: true
  port: 8100
  compliance: gdpr  # or hipaa, ccpa, pci-dss, finance, healthcare
  aggression: medium  # low | medium | high. how aggressive Layer 3 code rewriting is
                      # low:    only explicit domain_terms, identity, secrets
                      # medium: + compounds that contain a domain_term (default)
                      # high:   + every non-preserved AST identifier
  # mgmt_token: ""  # leave unset for localhost-only; generate with `openssl rand -hex 32`
                    # when binding to 0.0.0.0 (Docker, shared host). Required >= 16 chars.
  upstream:
    anthropic: https://api.anthropic.com
    openai: https://api.openai.com

session:
  persist: false                      # opt-in: keep pseudonyms across restarts
  persist_path: "./ainonymous-session.db"  # SQLite file, ciphertext only

# Optional sections (all additive; omit for defaults).
filters:
  disable: ["credit-card-preset"]             # drop a built-in OrPostFilter
  custom: ["./ainonymous-filters/ignore-support-tickets.mjs"]
  custom_pins:                                 # pin the file bytes (lowercase hex)
    ./ainonymous-filters/ignore-support-tickets.mjs: "a3f1..."

trust:
  allow_unsigned_local: false   # flip to true only after reviewing the .mjs

behavior:
  streaming:
    eager_flush: false          # release text at sentence/\n instead of per-safeSuffix
```

Session persistence is off by default. When enabled, the in-memory bimap is mirrored to an AES-256-GCM-encrypted SQLite file so that in-flight LLM responses still rehydrate correctly after a proxy restart. Requires Node.js 22.5+ (uses built-in `node:sqlite`, no native build). Provide a stable key via `AINONYMOUS_SESSION_KEY` (base64, 32 bytes) to keep the DB readable across processes. without it the DB is effectively wiped on every fresh start. See [SECURITY.md](SECURITY.md#session-map-persistence-opt-in) for the confidentiality model.

### domain_terms vs. preserve

Both lists affect Layer 3 (code semantics) but in opposite directions:

| List | Effect | Example |
|------|--------|---------|
| `domain_terms` | **Your** business concepts. Get pseudonymized to Greek-alphabet generics. | `CustomerLoyalty` → `AlphaService` |
| `preserve` | **Public** library / framework names. Stay untouched so the LLM recognizes them. | `Express`, `useState`, `Spring` stay as-is |

Rule of thumb: if Google's top 10 results for a term are your company's internal docs, it belongs in `domain_terms`. If they're public documentation, it belongs in `preserve`.

### Aggression modes

`behavior.aggression` controls how strictly Layer 3 (code semantics) rewrites identifiers:

| Mode | What gets pseudonymized | When to use |
|------|-------------------------|-------------|
| `low` | Compound + standalone `domain_terms` and `identity.*`. No AST identifier rewriting, no reverse-domain package-path rewrites. | Trusted code-review context where the LLM must see real class/method names; backwards-compat with the pre-v1.2 medium. |
| `medium` (default, v1.2+) | Everything in `low` plus full AST obfuscation (classes, interfaces, enums, methods, fields, type references, constructor names) and reverse-domain package-path rewrites. Java/Kotlin/Python/TS/Go/Rust/PHP/C# keyword and Spring/JPA/Lombok/Angular/NestJS/.NET/React-hook annotations stay intact. | Default hardened mode. Upstream sees pseudo class names but valid-looking syntax. |
| `high` | Everything in `medium` plus formal parameter names. Comment mentions of known identifiers get rewritten automatically via the replacement map. | Paranoid mode for heavily sensitive repos. Parameter names leak domain info in signatures (`process(SubscriptionEvent event)`). high covers that. |

Paths listed in `code.sensitive_paths` always run in `high` regardless of the global setting.

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

**Compliance is not certification.** These presets help you detect *likely* sensitive data. they do not make your use of an LLM regulator-approved. Verify with your DSB / DPO / compliance officer.

### Audit integrity (HMAC sidecar)

Operator runbook lives in [OPERATIONS.md](OPERATIONS.md#audit-hmac) (key
storage, rotation, recovery). The short version follows.

By default `audit verify` is a chain-consistency check, not cryptographic
tamper-evidence. From v1.3.0 you can enable an HMAC sidecar by exporting a
32-byte key before the proxy starts:

```bash
export AINONYMOUS_AUDIT_HMAC_KEY=$(openssl rand -base64 32)
ainonymous start
```

The logger writes a parallel `.jsonl.hmac` file with one `{seq, kid, mac}`
entry per audit record. `audit verify` then cross-checks the sidecar, and
flags tamper when either the jsonl or the sidecar was edited, when the
sidecar is missing, or when the key was silently unset at verify time.

Rotate without downtime of verify coverage by running the keyring
variant: export one `AINONYMOUS_AUDIT_HMAC_KEY_<KID>` per key and point
`AINONYMOUS_AUDIT_HMAC_ACTIVE_KID` at the one that should sign new
lines. Older kids stay verifiable as long as their env var is still
set. See [OPERATIONS.md](OPERATIONS.md#audit-hmac) for the secrets-manager
wiring (Vault, Azure Key Vault, AWS Secrets Manager).

### Management endpoint auth

By default the proxy binds to `127.0.0.1` and `/metrics`, `/metrics/json`, `/dashboard`, and `/events` are reachable without a token. If you bind to a non-local interface (e.g. `AINONYMOUS_HOST=0.0.0.0` in a container), set a bearer token so these endpoints are not exposed:

```bash
export AINONYMOUS_MGMT_TOKEN="$(openssl rand -hex 24)"
curl -H "Authorization: Bearer $AINONYMOUS_MGMT_TOKEN" http://localhost:8100/metrics
```

`AINONYMOUS_MGMT_TOKEN` overrides the `behavior.mgmt_token` config key. The token must be at least 16 characters. `/health` and `/v1/*` are never gated. health checks stay scrape-friendly and the API path is authenticated upstream.

Browsers cannot attach `Authorization` headers to `<link>` / `<script>` / `EventSource` requests, so when a token is set the HTML dashboard at `/dashboard` is effectively headless-only (curl, CI scrapers). Put a reverse proxy in front if you need browser access on a non-local bind. see `SECURITY.md` → "Dashboard access when a mgmt token is set".

## CLI reference

| Command | Description |
|---------|-------------|
| `ainonymous init` | Scan project, generate `.ainonymous.yml` |
| `ainonymous init --show` | Print the generated YAML to stdout without writing it |
| `ainonymous doctor` | Validate node version, config and port availability before first start |
| `ainonymous doctor --strict` | Same as `doctor`, but exits non-zero on any warning. Wire into CI. |
| `ainonymous doctor --force` | Ignore identity-coverage warnings and exit 0 (for setups that intentionally leave one field blank). |
| `ainonymous start` | Start the proxy server |
| `ainonymous start --open` | Start and open the dashboard in the default browser |
| `ainonymous stop` | Stop the running proxy |
| `ainonymous status` | Check if proxy is running |
| `ainonymous scan` | Dry run: histogram + top-files summary |
| `ainonymous scan --preview N` | Dry run: dump before/after text for the first N files with findings |
| `ainonymous scan --aggression low\|medium\|high` | Override Layer 3 aggression for the scan run (see BENCHMARKS.md). |
| `ainonymous scan -v` | Dry run: raw per-finding dump |
| `ainonymous audit tail` | Show last 20 audit log entries |
| `ainonymous audit pending` | Show pseudonyms the LLM response never referenced; splits sentinel-only entries out |
| `ainonymous audit verify` | Verify the SHA-256 hash chain across all audit JSONL files. Exit 0 clean, 2 tamper, 3 missing checkpoint under `--strict` |
| `ainonymous audit export` | Export logs as consolidated JSON (SIEM-ready) |
| `ainonymous config migrate` | Upgrade an older `.ainonymous.yml` to the current schema |
| `ainonymous preview --input-file <path>` | Offline dry-run: pipe a file or stdin through anonymization and print anonymized text + findings. Add `--json` for machine-readable output. |
| `ainonymous filters list` | Print the active OrPostFilter chain and any disabled built-ins |
| `ainonymous filters validate <path>` | Shape-check a custom `.mjs` filter module without registering it |
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

AInonymous reduces the risk of leaking sensitive data but **does not guarantee complete anonymization**. Keep these limits in mind:

- Regex-based detection has structural limits. Unusual formats, obfuscated data, or context-dependent PII may slip through.
- AST-based code semantics currently supports TypeScript, JavaScript, Java, Kotlin, Python, PHP, Go, Rust, and C#. Other languages fall back to domain-term replacement.
- Compliance presets (GDPR, HIPAA, etc.) provide detection patterns for common data types. **Using these presets does not make your organization compliant** with any regulation.
- The tool is not a substitute for a professional security audit or legal review.
- Streaming responses are rehydrated via a per-content-block sliding buffer that reassembles pseudonyms split across SSE event boundaries (e.g. `Alpha` | `Corp` | `Service`). The buffer sizes itself from the current session map's longest pseudonym, so the first visible text is delayed by roughly that many characters.
- OAuth subscription flows (Claude Code Max-Plan, Cursor Pro) route through the proxy once the tool respects `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`. The proxy passes the `Authorization: Bearer <token>` header through to the provider unchanged; only the request body is anonymized. What does not route is the browser-based OAuth *login* itself (that talks to `claude.ai` / provider-specific UIs, not `api.anthropic.com`) and any client that pins the upstream hostname. Enable `behavior.oauth_passthrough: true` to forward non-`/v1/messages` paths (OAuth refresh, organization lookups) as-is, without body anonymization.

You are responsible for reviewing what gets sent to LLM APIs. Use `ainonymous scan` to preview what would be anonymized before relying on the proxy.

## Troubleshooting

**Port 8100 already in use**
Another ainonymous instance is probably still running. `ainonymous status` shows it; `ainonymous stop` terminates it. If that fails, the shutdown token file lives under `$TMPDIR/ainonymous-8100.token` (POSIX) or `%USERPROFILE%\.ainonymous\ainonymous-8100.token` (Windows). delete it and `pkill -f ainonymous` / `taskkill`.

**Claude Code / Cursor not picking up the proxy**
The wrapper mode (`ainonymous -- claude`) sets `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` for the child process only. If the tool reads its URL from a different env var or a config file, set that explicitly. `claude config set base_url http://localhost:8100` works for Claude Code.

**Dashboard shows no events**
Check that `behavior.dashboard: true` in your `.ainonymous.yml`, that the browser is on the same machine, and that you open the `/dashboard` URL (not `/`). With a `mgmt_token` set, browsers cannot authenticate. use a reverse proxy or access via `curl -H "Authorization: Bearer ..."`.

**Config got garbled after editing**
`ainonymous scan` walks the project and shows what would be anonymized. it also surfaces YAML parse errors immediately. If your `.ainonymous.yml` is broken, the proxy refuses to start and points to the offending line. There is no built-in backup; keep the file in version control.

**Windows: shutdown token at `$TMPDIR` not found**
AInonymous on Windows writes to `%USERPROFILE%\.ainonymous\` instead of `%TEMP%` to ensure per-user ACL isolation. If you have scripts that assume `$TMPDIR`, update them to check both paths, or export `USERPROFILE` explicitly.

**Tree-sitter WASM fails to load on arm64**
`tree-sitter-wasms` ships prebuilt WASM for common triples. If your platform is unusual, the first `anonymize()` call will surface a load error with the exact path. File an issue with `uname -a` + the error.

**Custom filter appears to be ignored**
Run `ainonymous filters list`. If your filter id is not in the active chain, the proxy refused to load it - most common cause is `trust.allow_unsigned_local` left at the default `false`. Flip it to `true` in `.ainonymous.yml`, or pin the file via `filters.custom_pins` (lowercase SHA-256) when you want to keep the trust gate strict. `ainonymous filters validate <path>` shape-checks a single file without starting the proxy and prints the reason for any rejection.

## For security and compliance teams

If you're evaluating AInonymous on behalf of a security / privacy / legal organization rather than as an individual developer, these are the artefacts you probably want to read:

| Document | What it covers |
|----------|----------------|
| [THREAT_MODEL.md](THREAT_MODEL.md) | STRIDE + LINDDUN analysis of the proxy, session map, audit log, dashboard, CLI. Explicit residual risks (R1-R5), adversary classes, trust boundaries. |
| [SECURITY.md](SECURITY.md) | Responsible disclosure, security design (AES-256-GCM session map, CSP, timing-safe compares, Unicode normalization, Sigstore verification commands, session-persistence confidentiality model). |
| [BENCHMARKS.md](BENCHMARKS.md) | Measured p50/p95 anonymize and rehydrate latency, methodology, what is *not* measured. |
| [OPERATIONS.md](OPERATIONS.md) | Deployment (systemd hardened unit, Kubernetes NetworkPolicy), monitoring, incident response, audit log retention, capacity planning. |
| [legal/DPA-template.md](legal/DPA-template.md) | Auftragsverarbeitungsvertrag (AVV) / Data Processing Agreement starter, bilingual disclaimer. Covers the two scenarios where a DPA is actually needed around AInonymous. |
| [legal/Art30-GDPR-template.md](legal/Art30-GDPR-template.md) | Verzeichnis von Verarbeitungstätigkeiten nach Art. 30 DSGVO template with worked example. |

Telemetry: AInonymous does not send any data anywhere except the configured upstream LLM endpoint. There is no phone-home, no usage tracking, no error-reporting service. You can verify with `tcpdump` on `lo0`/`eth0` during a session - the only outbound connection is HTTPS to `api.anthropic.com` / `api.openai.com` (or the upstream you configured).

Maintenance model: solo-maintained, MIT-licensed, responses best-effort (see SECURITY.md). For enterprise adoption consider pinning the exact version (`"ainonymous": "1.3.0"`, not `^`), running `npm audit signatures` on upgrade, and verifying Sigstore signatures on the GitHub Release tarball. Commercial support is not part of this repository - see the "About" section at the bottom for contact.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run `make check` (TypeScript + ESLint)
4. Run `make test`
5. Open a PR

By submitting a pull request, you agree that your contribution is licensed under the MIT license.

## About

AInonymous is a solo-maintained project by [A-Som-Dev](https://github.com/A-Som-Dev), a freelance software engineer working on privacy-preserving tooling for companies that want to adopt AI assistants without handing sensitive source code to third parties. The tool was built for a concrete enterprise use case and open-sourced so that others facing the same problem can benefit.

If you find AInonymous useful in a commercial context, consider reaching out for consulting, integration help, or custom detection-rule packs for your industry.

## License

MIT
