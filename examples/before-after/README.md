# Before / After examples

What a realistic prompt looks like before AInonymity and what the LLM actually sees after.

## The three demos

| Language | Before | After | What it shows |
|---|---|---|---|
| Java (Spring Boot) | [`input.md`](input.md) | [`output.md`](output.md) | Service class, reverse-domain package path, domain term "Customer", person in comment, hardcoded DB password |
| Python (Django + DRF) | [`django-view-before.py`](django-view-before.py) | [`django-view-after.py`](django-view-after.py) | ViewSet, internal runbook URL, legal/ops mail aliases, `CUSTOMERDB_API_KEY` secret in settings reference, legacy view with bearer token in query string |
| Go (chi + pgx) | [`go-http-handler-before.go`](go-http-handler-before.go) | [`go-http-handler-after.go`](go-http-handler-after.go) | `package`/import paths on an internal GitLab host, Postgres DSN with inline password, oncall runbook, slog fields leaking actor and partner IDs |

## How to read the files

- `*-before.*` — what you'd paste into Claude/Cursor/etc.
- `*-after.*` — what the proxy forwards to the upstream LLM after the three layers (Secrets → Identity → Code) have run.

The Java demo is generated deterministically from `input.md` via `gen.mjs` (seeded Greek-alphabet pseudonyms). The Python and Go demos are hand-curated reference outputs that use the same Greek scheme so cross-file pseudonyms stay consistent with what the pipeline would produce for a similar session.

## Reproduce the Java demo

```bash
npm run build
node examples/before-after/gen.mjs
```

## Reproduce the Python / Go demos end-to-end

These files are not wired to `gen.mjs` because realistic `.py`/`.go` input would need language-specific config. To see AInonymity process them live:

```bash
ainonymous start --config ./examples/enterprise.ainonymity.yml
# then paste the contents of django-view-before.py (or the Go file) into Claude/Cursor
# the proxy will forward the anonymized version, which should closely match the *-after.* file
```

Exact pseudonyms will differ from the checked-in `-after` files (pseudonym numbering depends on the order identifiers appear in a given session), but the *shape* of the anonymization — which tokens get replaced, which stay, and which get redacted — should match.

## Layer coverage across all three demos

| What leaks without AInonymity | Layer | How it's handled |
|---|---|---|
| `hunter2topsecret!`, `hunter2staging`, `cdb_live_0000000000` | 1 Secrets | Password / API-key patterns → `***REDACTED***` (permanent, never rehydrated) |
| `Acme Corp`, `Acme`, `acme-corp.com`, `acme.internal`, `gitlab.acme-corp.local` | 2 Identity | Company + domain pseudonyms, consistent per session |
| `Artur Sommer`, `Kay Example`, `M. Example`, `rexample` | 2 Identity | Configured people + NER dictionary → `Person Alpha`, `Person Beta`, ... |
| `artur.sommer@acme-gmbh.de`, `ops@acme-logistics.de` | 2 Identity | Email detection → `user1@company-alpha.de` |
| `10.42.0.17` | 2 Identity | IPv4 pattern → `10.0.x.y` slot |
| `com.acmecorp.customerdb.*`, `gitlab.acme-corp.local/platform/...` | 3 Code | Reverse-domain + path segments anonymized; TLD preserved |
| `CustomerBillingService`, `AcmeCustomerLoyaltyViewSet`, `PartnerContactView` | 3 Code | Domain terms (`Customer`, `Partner`, ...) trigger compound pseudonymization; `Service`/`ViewSet`/`View` suffixes preserved |
| `CustomerLoyalty`, `PartnerAgreement` model names | 3 Code | Same — domain term is the trigger; structural word stays |
