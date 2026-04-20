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
  ainonymous:1.2.2

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

The verifier is a **chain-consistency check**, not a tamper-evidence
authentication. Checkpoint sidecars commit `lastSeq + lastHash`, but an
attacker with write access to both the JSONL files and the `.checkpoint` can
truncate both and re-derive a self-consistent chain. HMAC-signed checkpoints
are tracked for v1.3 (see THREAT_MODEL.md). Meanwhile,
ship `.checkpoint` files to an append-only store (S3 Object Lock, git
commit, remote syslog) for external tamper evidence.

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
# or: docker pull ainonymous:1.2.2

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
