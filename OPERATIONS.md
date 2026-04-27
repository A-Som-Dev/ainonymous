# Operations Manual

Runbook for operating AInonymous in a production-like environment.

## Start / Stop

```bash
# Foreground (development)
ainonymous start

# As a systemd service (see Deployment below)
systemctl start ainonymous

# As a Docker container
docker run -d --name ainonymous \
  -p 127.0.0.1:8100:8100 \
  -v /var/lib/ainonymous/audit:/app/ainonymous-audit \
  -e AINONYMOUS_HOST=0.0.0.0 \
  ainonymous:1.3.0

# Pre-flight check (exit non-zero under --strict if node version,
# port availability, or config validation produce any warning)
ainonymous doctor --strict

# Graceful shutdown
ainonymous stop
# or: curl http://127.0.0.1:8100/shutdown?token=$(cat /tmp/ainonymous-8100.token)
```

## Health & Metrics

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe. Returns JSON `{ status: "ok", ... }`. |
| `GET /metrics` | Prometheus text format. Counters for requests, audit entries; gauges for uptime and session map size. |
| `GET /metrics/json` | Same data, JSON. For legacy scrapers. |
| `GET /dashboard` | Live audit stream UI (localhost only by default). |

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: ainonymous
    static_configs:
      - targets: ['127.0.0.1:8100']
    metrics_path: /metrics
    # Only needed when AINONYMOUS_MGMT_TOKEN / behavior.mgmt_token is set.
    # Omit the whole bearer_token_file block for token-less local deployments.
    # authorization:
    #   type: Bearer
    #   credentials_file: /etc/prometheus/ainonymous-token
```

## Logs

All operational logs are structured JSON on stdout/stderr:

```json
{"level":"error","ts":"2026-04-16T09:40:42.774Z","msg":"upstream request failed","upstream":"https://api.anthropic.com","err":"ECONNREFUSED"}
```

Ship to your SIEM via Filebeat, Fluent Bit, or `journalctl -o json` for systemd deployments.

CLI user-facing messages (`proxy started on ...`) stay plain text. filter them out with `level != ""` in your log pipeline.

## Audit Log

Entries are hash-chained JSONL in `./ainonymous-audit/ainonymous-audit-YYYY-MM-DD.jsonl`. Files rotate at 10 MB to `.part1.jsonl`, `.part2.jsonl`, etc.

**Verify integrity (CLI):**

```bash
ainonymous audit verify --dir /var/lib/ainonymous/audit
# exit 0 = clean
# exit 2 = tamper (hash mismatch)
# exit 3 = missing-checkpoint (only under --strict)

# Strict mode: also treat a missing .checkpoint sidecar as tamper.
# Recommended for nightly SIEM runs.
ainonymous audit verify --dir /var/lib/ainonymous/audit --strict
```

The chain-check alone is a **consistency** check, not cryptographic
tamper-evidence. An attacker with write access to both the JSONL files and
the `.checkpoint` can truncate both and re-derive a self-consistent chain.
From v1.3.0 onwards the HMAC-Sidecar ("Audit HMAC" section below) closes
that gap when an operator-managed key is configured. If HMAC is not an
option, ship `.checkpoint` files to an append-only store (S3 Object Lock,
git commit, remote syslog) for external tamper evidence.

**Library usage:**

```js
import { verifyAuditChain } from 'ainonymous/dist/audit/logger.js';
import { readFileSync } from 'node:fs';

const lines = readFileSync('ainonymous-audit-2026-04-16.jsonl', 'utf-8').split('\n');
const badSeq = verifyAuditChain(lines);
console.log(badSeq === null ? 'OK' : `chain broken at seq=${badSeq}`);
```

### Cron Template

Nightly verify with alerting. Exit non-zero wakes the operator:

```cron
# /etc/cron.d/ainonymous-audit-verify
0 3 * * * ainonymous /usr/bin/env bash -c 'ainonymous audit verify --dir /var/lib/ainonymous/audit --strict || echo "ainonymous audit chain broken on $(hostname)" | mail -s "AUDIT ALERT" ops@example.com'
```

systemd-timer alternative (`/etc/systemd/system/ainonymous-audit-verify.{service,timer}`):

```ini
# .service
[Unit]
Description=AInonymous audit chain verify
[Service]
Type=oneshot
ExecStart=/usr/local/bin/ainonymous audit verify --dir /var/lib/ainonymous/audit --strict
User=ainonymous

# .timer
[Unit]
Description=Nightly audit chain verify
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

The Prometheus endpoint exposes `ainonymous_audit_chain_broken_total` (counter
of currently-failing files) and `ainonymous_audit_chain_broken{file="..."}`
(per-file 0/1 gauge). Alert on either > 0.

**Retention:** No automatic purge. AInonymous treats retention as an operator responsibility, not a library concern. your legal/compliance requirements vary and an opinionated built-in would be wrong for many deployments. Schedule a cron job matching your policy (GDPR Art. 17, "right to erasure", typically 30-90 days for operational logs):

```bash
# Daily purge, 90-day retention
0 3 * * * find /var/lib/ainonymous/audit -name 'ainonymous-audit-*.jsonl*' -mtime +90 -delete
```

For shorter retention, pair with hash-chain verification before deletion so tampering is detected before evidence is destroyed.

### Verify exit codes

`ainonymous audit verify` returns one of:

- `0` - all JSONL files in the directory have a consistent chain (and
  matching HMAC sidecars if `AINONYMOUS_AUDIT_HMAC_KEY` is set).
- `2` - at least one file reports `tamper` (chain mismatch, HMAC
  mismatch, malformed checkpoint, or an HMAC sidecar that exists while
  the verify-time key is unset).
- `3` - under `--strict`, at least one file has no `.checkpoint`.
- `1` - no audit logs in the directory, or CLI misuse.

Pipe a non-zero exit into your alerting (`|| page-oncall`).

## Audit HMAC

The chain-check under `audit verify` is a consistency check only. Set
`AINONYMOUS_AUDIT_HMAC_KEY` to a base64-encoded 32-byte key before the
proxy starts to add HMAC-SHA256 tamper-evidence:

```bash
export AINONYMOUS_AUDIT_HMAC_KEY=$(openssl rand -base64 32)
# or from a secrets store
export AINONYMOUS_AUDIT_HMAC_KEY=$(vault read -field=key secret/ainonymous/audit)

ainonymous start
```

The logger writes a parallel `.jsonl.hmac` sidecar (one `{seq, kid, mac}`
record per entry). `audit verify` cross-checks the sidecar via
`crypto.timingSafeEqual` and returns `tamper` when the sidecar is
missing, the key is silently unset at verify time, or any entry no
longer matches its recorded MAC.

**Rotation requires a proxy restart.** `AINONYMOUS_AUDIT_HMAC_KEY` is read
once at Logger construction and cached; changing the env var at runtime
(SIGHUP, `export`) does not pick up the new key. Drain traffic, stop the
proxy, update the env, start the proxy. The same holds for
`AINONYMOUS_MGMT_TOKEN` and `AINONYMOUS_SESSION_KEY`: all three env-sourced
secrets are resolved at startup and cached for the process lifetime.

**Rotation workflow** (keyring). The sidecar entries carry a `kid` field.
Provide one key per kid through environment variables and tell the
proxy which kid is active. Older kids remain verifiable as long as they
stay in the environment. The kid is the suffix after
`AINONYMOUS_AUDIT_HMAC_KEY_`, lowercased, and must match
`^[a-z0-9][a-z0-9._-]{0,63}$`. Shell convention is to keep env-var names
uppercase, so `AINONYMOUS_AUDIT_HMAC_KEY_V1` and
`AINONYMOUS_AUDIT_HMAC_KEY_v1` resolve to the same kid `v1`:

```bash
export AINONYMOUS_AUDIT_HMAC_KEY_V1=$(vault read -field=key secret/ainonymous/audit/v1)
export AINONYMOUS_AUDIT_HMAC_KEY_V2=$(vault read -field=key secret/ainonymous/audit/v2)
export AINONYMOUS_AUDIT_HMAC_ACTIVE_KID=v2
ainonymous start
```

On POSIX, the proxy re-reads the `AINONYMOUS_AUDIT_HMAC_KEY_*` env vars
on `SIGHUP`, so you can rotate the active kid at runtime without
restarting. Keep the previous kid exported until its JSONL+sidecar pair
is archived; `audit verify` needs both to round-trip older entries.

New log lines are signed with `v2`. Existing sidecar lines tagged `v1`
still verify as long as `AINONYMOUS_AUDIT_HMAC_KEY_V1` is exported.
Retire `v1` by removing the export only after you have archived the
affected JSONL+sidecar pair off-host.

The legacy single-key env `AINONYMOUS_AUDIT_HMAC_KEY` is treated as
`kid=default` and can run alongside the keyring during migration. Mixing
kids within one log file is still rejected as tamper (downgrade guard).

**Secrets-manager integration**. Any store that can emit a base64 blob
into the process env works. Reference patterns:

```bash
# HashiCorp Vault
export AINONYMOUS_AUDIT_HMAC_KEY_V2=$(vault kv get -field=hmac_key secret/ainonymous/audit/v2)

# Azure Key Vault (via CLI)
export AINONYMOUS_AUDIT_HMAC_KEY_V2=$(az keyvault secret show \
  --vault-name ainonymous-prod --name audit-hmac-v2 --query value -o tsv)

# AWS Secrets Manager
export AINONYMOUS_AUDIT_HMAC_KEY_V2=$(aws secretsmanager get-secret-value \
  --secret-id ainonymous/audit/hmac-v2 --query SecretString --output text)
```

Drive rotation from the same workflow: add the new kid to the store,
restart the proxy with both kids exported and `ACTIVE_KID` pointing at
the new one, retire the old kid once the archival window has passed.

**Incident response on key leak**. If `AINONYMOUS_AUDIT_HMAC_KEY` has
been exposed:

1. Assume all existing `.hmac` sidecars from the leak window offer no
   tamper evidence against the leaker.
2. Rotate to a new key immediately (see above) and restart the proxy.
3. Replicate both the JSONL files and the existing sidecars into your
   append-only external store with a timestamp before rotation. External
   storage becomes the evidence medium for the leaked window.
4. Document the leak window in the incident log. Downstream auditors
   need to know which log ranges are only chain-consistency-protected.

## External Audit Watermark

v1.3.0 ships an external watermark that lives outside the audit directory
(default `~/.ainonymous/audit-state/<first-32-hex-chars-of-sha256(audit_dir)>.json`,
override via `AINONYMOUS_STATE_HOME`). The watermark closes the
atomic 3-tuple replay window (jsonl + checkpoint + checkpoint.hmac
all rolled back together).

**Operational notes:**

- The watermark is written via write-then-rename so a crash mid-write
  cannot leave a torn JSON body that the read side would silently treat
  as absent.
- The read side runs unconditionally. `AINONYMOUS_AUDIT_NO_WATERMARK=1`
  only skips writes (for tests / ephemeral runs) and emits a one-shot
  NOTICE so the situation is visible in logs.
- A subsequent restart without the env will refuse to seed (the watermark
  is now genuinely missing). Either keep the env consistent for the
  lifetime of an audit dir or wipe the audit dir before restart.

**Upgrade from a pre-1.3.0 build.** A pre-1.3.0 audit directory has
checkpoint files but no external watermark. On first start under
v1.3.0+ the logger will print:

```
WARNING: audit checkpoint exists at ... but the external watermark at ... is missing;
refusing to seed chain. If this is a clean upgrade from a pre-1.3.0 build,
remove the audit directory and restart to start a fresh chain.
```

The supported upgrade procedure is:

```bash
# 1. Run audit verify against the old directory and archive the result
ainonymous audit verify ./ainonymous-audit > pre-upgrade-verify.txt

# 2. Move the old directory aside (do not delete - you may need it for
#    GDPR Art 30 evidence)
mv ./ainonymous-audit ./ainonymous-audit.pre-1.3.0

# 3. Start the new build with a fresh audit dir
ainonymous start
```

The old chain remains independently verifiable with `audit verify`. The
new chain starts at seq=0 under v1.3.0's stricter integrity model
(checkpoint MAC v=2 + watermark + tail-seq compare).

A first-class `audit migrate` command is tracked for a future release.

### Migrating from keyless to HMAC mode

A proxy started without `AINONYMOUS_AUDIT_HMAC_KEY` writes the audit chain in keyless mode: per-entry sidecar `.jsonl.hmac` files are not produced and the external watermark is written without a `kid`/`mac`. After turning HMAC on, the next `seedFromCheckpoint` will refuse with **"audit watermark missing signature while HMAC is configured"** because the existing watermark has no MAC. The supported procedure is:

```bash
# 1. Drain in-flight traffic and stop the proxy.
ainonymous stop

# 2. Verify and archive the keyless chain (it stays independently
#    verifiable under chain-consistency rules).
ainonymous audit verify ./ainonymous-audit > pre-hmac-verify.txt
mv ./ainonymous-audit ./ainonymous-audit.keyless

# 3. Remove the legacy watermark for this audit_dir so the new chain
#    starts cleanly. The path is
#    "$AINONYMOUS_STATE_HOME/audit-state/<first-32-hex-chars-of-sha256(audit_dir)>.json".
rm -f ~/.ainonymous/audit-state/*.json

# 4. Generate a key, export it, and start the proxy with a fresh audit dir.
export AINONYMOUS_AUDIT_HMAC_KEY=$(openssl rand -base64 32)
ainonymous start
```

The first persist after restart writes a new HMAC-signed watermark and per-entry sidecar. The archived keyless chain remains as evidence for the pre-migration window; any audit window analysis that needs to span both must aggregate `pre-hmac-verify.txt` and the new `audit verify` output side-by-side.

The reverse direction (keyed → keyless) is not supported: dropping the key downgrades the integrity tier and the existing per-entry `.jsonl.hmac` sidecars would refuse to verify on the next run.

## Session Key Rotation

When `session.persist: true`, the SQLite store is encrypted under `AINONYMOUS_SESSION_KEY`. The current v1.0 flow is explicit and manual. no online rotation CLI:

```bash
# 1. Drain in-flight traffic (route to a second instance or accept the partial outage)
ainonymous stop

# 2. Generate a new key and keep the old one handy for one-shot re-encryption
OLD_KEY=$AINONYMOUS_SESSION_KEY
NEW_KEY=$(openssl rand -base64 32)

# 3a. If you do NOT need to carry existing mappings across:
#     drop the SQLite file and start fresh with the new key.
rm -f /var/lib/ainonymous/session.db
export AINONYMOUS_SESSION_KEY=$NEW_KEY
ainonymous start

# 3b. If you DO need to carry existing mappings across:
#     use a short Node script that opens the store with the old key,
#     calls PersistStore.rotate(newKey) and closes. Example in
#     docs/examples/rotate-session-key.mjs (ships with the repo).
```

If an entry in the SQLite file cannot be decrypted after rotation (wrong key, tampering, truncated file), the proxy discards that row at load time with an aggregated `log.warn`. no silent data corruption, but mapping for the affected entry is lost.

A first-class `ainonymous key rotate` command is tracked as a v1.2 candidate (see THREAT_MODEL.md).

## Upgrade

```bash
# 1. Stop the current instance
ainonymous stop

# 2. Verify audit log integrity before the upgrade
#    (so you can distinguish upgrade issues from pre-existing corruption)

# 3. Upgrade
npm install -g ainonymous@latest
# or: docker pull ainonymous:1.3.0

# 4. Start
ainonymous start

# 5. Smoke test
curl -s http://127.0.0.1:8100/health
```

Pseudonyms are not persisted across restarts by default. In-flight requests that started before the restart will hit a fresh session map and the rehydration for them will not find the original values. Treat a restart as a partial outage unless you have opted in to `session.persist: true` with a stable `AINONYMOUS_SESSION_KEY`. that combination keeps the AES-256-GCM SQLite store readable across processes.

## Rollback

```bash
ainonymous stop
npm install -g ainonymous@<previous-version>
ainonymous start
```

Audit logs from the newer version are backward-compatible. the `seq` and `prevHash` fields are optional in the schema.

## Concurrent AuditLogger instances on the same persist_dir

Run **one** AuditLogger per `audit.persist_dir`. The append to `*.jsonl` is
POSIX-atomic per write, but the `.checkpoint` and `.checkpoint.hmac` sidecars
are rewritten via `atomicWriteFileSync` (write-then-rename) on every entry.
Two writers in the same directory race on the rename, so the surviving
`.checkpoint.hmac` may sign a different `.checkpoint` blob than is on disk.
The next restart catches the mismatch (`audit verify` reports a signature
mismatch and `seedFromCheckpoint` refuses to seed), so no silent corruption,
but the chain becomes unverifiable until the operator clears it.

If you need to scale write throughput, give each worker its own `persist_dir`
and merge offline. A future release will add a process-level lockfile
(`.checkpoint.lock` with `O_EXCL`) so the second writer fails fast at
startup; for v1.3.0 this is operator-side discipline.

## Incident Response

### Suspected secret in audit log

The audit log stores only SHA-256 hashes of originals, not plaintext. If you observe plaintext in the audit file, the cause is one of:

1. A pattern mis-classified the secret as non-sensitive and it ended up in the `pseudonym` field.
2. The log pipeline is writing something other than `AuditLogger` output.

Rotate the file, verify the chain, open an issue with the entry's `seq` and `type`.

### Proxy crashed / unresponsive

1. Check liveness: `curl -sf http://127.0.0.1:8100/health` → if non-200, assume dead.
2. Check for stuck upstream: default request timeout is 30 s. Upstream response size cap is 50 MB. Oversized responses are rejected with `upstream_error`.
3. `journalctl -u ainonymous --since "5 min ago"` for the last error.
4. Restart: `systemctl restart ainonymous`. in-flight sessions are lost.

### Port conflict

`ainonymous start` without `--port` uses `behavior.port` from config. If occupied:

- `ainonymous stop` stops the previous instance. The shutdown token lives at `$TMPDIR/ainonymous-<port>.token` on POSIX and `%USERPROFILE%\.ainonymous\ainonymous-<port>.token` on Windows (the latter is `icacls`-hardened on first start).
- `ainonymous start -p 8101` picks an explicit free port.
- `ainonymous scan --dashboard` auto-falls back to the next free port (up to 10 retries).

### Upstream API outage

All `502 upstream_error` responses from the proxy mean the upstream API (Anthropic/OpenAI) is failing. The proxy itself is fine. Check the provider's status page.

## Deployment

### Kubernetes

The proxy's management endpoints (`/metrics`, `/metrics/json`, `/dashboard`, `/dashboard/app.js`, `/dashboard/app.css`, `/events`) accept a bearer token via `AINONYMOUS_MGMT_TOKEN` (env) or `behavior.mgmt_token` (config). Set one in any non-localhost deployment. The `NetworkPolicy` below is still recommended as defense-in-depth. no token is a substitute for network isolation.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ainonymous-isolate
  namespace: ainonymous
spec:
  podSelector:
    matchLabels:
      app: ainonymous
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Accept anonymization requests only from the IDE sidecar / developer workstation tunnel
    - from:
        - podSelector:
            matchLabels:
              role: llm-client
      ports:
        - protocol: TCP
          port: 8100
  egress:
    # Only allow outbound to the configured LLM upstreams (plus DNS)
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: UDP
          port: 53
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - protocol: TCP
          port: 443
```

Pair this with a `SecurityContext` that sets `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, and an emptyDir for `/app/ainonymous-audit`.

### systemd unit

`/etc/systemd/system/ainonymous.service`:

```ini
[Unit]
Description=AInonymous LLM anonymization proxy
After=network.target

[Service]
Type=simple
User=ainonymous
Group=ainonymous
WorkingDirectory=/var/lib/ainonymous
ExecStart=/usr/bin/ainonymous start
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

# Required if you bind to anything other than 127.0.0.1. Also strongly
# recommended on shared/multi-user hosts. Use systemd-creds or a separate
# EnvironmentFile with mode 0600 instead of inlining the secret here.
# EnvironmentFile=/etc/ainonymous/env
# The env file should contain lines like:
#   AINONYMOUS_MGMT_TOKEN=<32+ byte hex>
#   AINONYMOUS_SESSION_KEY=<base64, exactly 32 bytes decoded>   # if session.persist: true

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/ainonymous
PrivateTmp=true
ProtectHome=true
CapabilityBoundingSet=
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources

[Install]
WantedBy=multi-user.target
```

## Capacity

- Request timeout: 30 s per upstream call.
- SSE buffer: 1 MB per chunk before forced flush.
- Max response size: 50 MB per request.
- Session map: in-memory, unbounded. Plan for ~463 bytes per entry (measured, includes forward+reverse maps and encryption overhead).
- HTTPS keep-alive pool: 50 sockets per upstream.

For heavy workloads (100+ concurrent requests, multi-MB responses), benchmark in your environment before rollout.

## Known Limitations

See `SECURITY.md` and `README.md` for detail. Most important for operators:

- Session map persistence is opt-in via `session.persist: true` + `AINONYMOUS_SESSION_KEY`. Off by default; on a restart the map is empty unless you enabled it.
- `sensitive_paths` / `redact_bodies` apply only during `ainonymous scan`, not at proxy time (use `// @ainonymous:redact` comments for proxy-time body redaction).
- Management endpoints (`/metrics`, `/metrics/json`, `/dashboard`, `/dashboard/app.js`, `/dashboard/app.css`, `/events`) are bearer-token-protected when `behavior.mgmt_token` or `AINONYMOUS_MGMT_TOKEN` is set. Default is token-less but the proxy refuses to expose on non-localhost without a token on startup warning. Keep behind a network policy regardless.
- The audit log is a SHA-256 hash chain, not an HMAC. Tampering is detectable against external adversaries without filesystem write access; an insider with write access to the audit dir can forge or truncate the tail. Mitigate by shipping the JSONL to an append-only sink (S3 Object Lock, immutable Loki index).
- **Single writer per `audit_dir`**. The chain-hash seq counter and the `.checkpoint` sidecar assume one logger instance per directory. Running two proxies that share the same `behavior.audit_dir` interleaves sequence numbers and makes `audit verify` report tamper on a benign concurrency collision. Each instance needs its own directory (Kubernetes: per-pod PVC; systemd: per-unit WorkingDirectory), or a shared external log sink consumes each proxy's stream separately.
