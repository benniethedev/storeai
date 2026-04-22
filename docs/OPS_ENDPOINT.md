# Ops endpoint — `GET /api/ops/overview`

A read-only, aggregate-only metrics endpoint for external monitoring dashboards. Designed after an env-exfiltration incident — this endpoint is a target, so every field has been audited to ensure it leaks no row-level data, no PII, no secrets, and no path detail.

---

## Contract

**Method:** `GET`
**Path:** `/api/ops/overview`
**Auth:** `Authorization: Bearer sa_ops_<…>` — see [Tokens](#tokens).
**Response:** `200` on success (even when subsystems are degraded — see [Fail-closed](#fail-closed)). `401` on any auth failure.

### Response shape

```jsonc
{
  "ok": true,
  "service": "storeai",
  "generated_at": "2026-04-22T10:55:00.000Z",

  // Written at build time by scripts/write-build-info.mjs; read at runtime
  // from apps/web/build-info.json — no shell-outs in the request path.
  "build": {
    "commit": "17369a3c8b9e2f4a...",
    "commit_subject": "security: RCE remediation — loopback default...",
    "built_at": "2026-04-22T09:33:45.000Z",
    "recent_commits": [
      { "sha": "17369a3", "subject": "security: RCE remediation..." },
      { "sha": "07a4bf8", "subject": "ci: rewrite test job..." }
      // up to 5
    ]
  },

  // Per-subsystem probes. "status" is "ok" iff every named subsystem is "ok".
  "health": {
    "status":   "ok" | "degraded",
    "postgres": "ok" | "degraded",
    "redis":    "ok" | "degraded",
    "storage":  "ok" | "degraded",
    "worker":   "ok" | "degraded"
  },

  // Snapshot counts. All integers. No identifying strings.
  "totals": {
    "tenants":          42,
    "users":            137,
    "projects":         293,
    "records":          10451,
    "files":            812,
    "api_keys_active":  18,
    "sessions_active":  54
  },

  // Approximate last-24-hour counts. Sourced from audit_logs + Redis
  // day-bucket counters (today + yesterday summed).
  "counts_24h": {
    "signups":              3,
    "logins_success":       47,
    "logins_failed":        12,
    "api_key_auth_failed":  2,
    "probe_hits":           1241,
    "rate_limited":         0,
    "audit_events":         83,
    "usage_events":         1902
  },

  // HTTP response distribution over the same ~24h window.
  "http_24h": {
    "2xx": 1720,
    "3xx": 18,
    "4xx": 164,
    "5xx": 0,
    "p95_latency_ms": null   // reserved; reservoir sampling not implemented in v1
  },

  // BullMQ queue depths.
  "queue": {
    "file_post_process": { "waiting": 0, "active": 0, "failed": 0 },
    "audit_fanout":      { "waiting": 0, "active": 0, "failed": 0 }
  }
}
```

### What this endpoint does NOT and will NEVER expose

Locked in by the CI grep in `.github/workflows/deploy-preflight.yml`:

- **No emails** — user or admin.
- **No password hashes or secrets** of any kind.
- **No API-key values** (prefix, full key, or secret hash).
- **No session tokens.**
- **No IP addresses.**
- **No user agents.**
- **No user names, tenant names, tenant slugs, or project names.**
- **No path-level detail** (which route, which resource id).
- **No stack traces or exception text** — if a subsystem probe fails, the field becomes `"degraded"` and the exception is swallowed.

If you need any of this for an internal tool, build a separate endpoint behind `requireUserSession()` + platform-admin check. Do not widen `/api/ops/*`.

---

## Tokens

Tokens live in the `ops_tokens` table. Only the argon2id hash is persisted; the plaintext is shown once at issuance and cannot be recovered. There is **no** UI, no list endpoint, and no rotation endpoint — operators issue via SSH.

### Issue

```bash
pnpm ops:issue-token --name "netswagger-dashboard"
```

Output:

```
  Ops token issued.

  Name:  netswagger-dashboard
  ID:    01fac659-0353-4554-9881-4d903646f552

  Token (shown once — copy now):

    sa_ops_uvLKGgLHXAnTUAz0fd4okgR_A4C8MaVhnd_L_0LzFI7fSTaDm9uyNzEeRKNGhKZL
```

Tokens are 48 random bytes, base64url-encoded. `sa_ops_` is the literal prefix used for client-side recognition; it contains no cryptographic information.

### Revoke

SSH to the host and run:

```bash
psql "$DATABASE_URL" -c "UPDATE ops_tokens SET revoked_at = now() WHERE id = '<id>';"
# or, for one named token:
psql "$DATABASE_URL" -c "UPDATE ops_tokens SET revoked_at = now() WHERE name = 'netswagger-dashboard' AND revoked_at IS NULL;"
```

Revoked tokens are rejected on the next call. They remain in the table for audit.

### Audit trail

Every successful call writes an `audit_logs` row with:

- `action = 'ops.read'`
- `resource_type = 'ops'`
- `metadata = { token_id, token_name }`
- `tenant_id = null` (platform-level event)

Failed auth attempts do not write audit rows (intentional — avoids audit-log amplification under brute-force). The rate limiter, if configured, will trip before brute force succeeds.

---

## Polling cadence

**Recommended: 30–60s.** Calls are cheap (~10ms steady-state on a warm process) but each call runs:

- 13 Postgres `SELECT COUNT(*)` queries in parallel
- 3 Redis `MGET` / `HGETALL` calls
- 1 MinIO `HeadBucket`
- 1 `ops_tokens` scan for auth (O(n) where n = number of active ops tokens; expect < 10)

Polling faster than every 10s will start to show up on the Postgres load graph. Don't.

If your dashboard needs sub-second freshness for a specific field, add that field as a WebSocket/SSE event from the app itself rather than polling this endpoint harder.

---

## Rate limiting

### In the route (always on)

Every `/api/ops/*` request is throttled **per token** at **30 requests / 60 seconds** (see `apps/web/src/lib/opsConfig.ts`). On the 31st request within the window the route returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: <seconds-until-window-closes>
Content-Type: application/json

{ "ok": false, "error": { "code": "rate_limited" } }
```

The 429 also increments `metrics:rate_limited:YYYYMMDD`, which surfaces on this same endpoint as `counts_24h.rate_limited` — so a misbehaving dashboard (or a leaked token) announces itself in the payload.

Different tokens get independent buckets: one abusive token does not starve others.

### Caddy layer (optional, defense in depth)

`infrastructure/caddy/Caddyfile.example` ships a commented `@ops` matcher and a commented `rate_limit` block. For production:

1. Uncomment `remote_ip <dashboard-egress-ip>` inside `@ops` to restrict which source IPs can reach the endpoint.
2. To enable the edge rate limit, rebuild Caddy with the `caddy-ratelimit` module:
   ```bash
   xcaddy build --with github.com/mholt/caddy-ratelimit
   # or, on a recent Caddy that supports it:
   caddy add-package github.com/mholt/caddy-ratelimit
   ```
   Then uncomment the `rate_limit` block. The default apt `caddy` package does **not** include this module.

The in-app per-token limit is sufficient on its own; the Caddy layer is useful if you're getting hammered at the edge (e.g. a leaked token being reused faster than you can revoke).

---

## Fail-closed

Each subsystem probe (`probePostgres`, `probeRedis`, `probeStorage`) is wrapped in:

```ts
async function probe(fn, timeoutMs = 2000) {
  try { await Promise.race([fn(), timeout(timeoutMs)]); return "ok"; }
  catch { return "degraded"; }
}
```

- The probe never throws.
- The exception text is **never** included in the response.
- DB-sourced totals zero-fill if Postgres is reporting "degraded" — the request stays 200.
- Redis-sourced counters fail open via `redisSafe()` — they return `0` if Redis is unreachable.

Acceptance test in `apps/web/tests/ops.test.ts`:

> Killing Postgres turns `health.postgres` → `degraded` and `totals.users` → `0`, but the endpoint returns `200`.

---

## Headers

The response is JSON with `Cache-Control` set by Next.js defaults. Callers should treat it as uncacheable.

---

## Rate behavior & performance targets

- Steady-state (warm process, all deps healthy): **< 200ms**.
- With one subsystem down (probe times out at 2s): **~2s** for the slowest probe, parallel with the others.
- Under Redis outage: Redis-sourced counters return `0`; latency unaffected (redisSafe wraps every call with a 2s timeout).

If you see the endpoint sustainedly above 500ms steady-state, the most common cause is the `ops_tokens` scan cost growing — revoke unused tokens.

---

## Related

- Schema: `packages/db/src/schema.ts` — `opsTokens` table (search `ops_tokens`)
- Auth: `packages/auth/src/opsTokens.ts` — `issueOpsToken`, `resolveOpsToken`, `revokeOpsToken`
- Handler: `apps/web/src/app/api/ops/overview/route.ts`
- Metrics: `apps/web/src/lib/metrics.ts`
- Build info: `apps/web/scripts/write-build-info.mjs` + `apps/web/src/lib/buildInfo.ts`
- CI guard: `.github/workflows/deploy-preflight.yml` → `env-sanity` → `Ops endpoint must never reference PII or secrets`
- Tests: `apps/web/tests/ops.test.ts`
