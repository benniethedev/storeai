# Architecture

## Process topology

```
┌──────────────────────┐     ┌──────────────────────┐
│  Next.js (apps/web)  │     │  Worker (apps/worker)│
│  dashboard + /api    │     │  BullMQ consumer     │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           ▼                            ▼
    ┌──────────────┐            ┌──────────────┐
    │  PostgreSQL  │◀──────────▶│    Redis     │
    └──────────────┘            └──────────────┘
           ▲
           │
    ┌──────────────┐
    │    MinIO     │
    └──────────────┘
```

Both processes import the same `@storeai/*` packages. The web app enqueues jobs; the worker consumes them. Everything that mutates state goes through the web app first so permission checks are enforced in one place.

## Request lifecycle (tenant route)

1. Route wrapper `tenantRoute()` receives the `NextRequest`.
2. `requireTenantContext(req)` resolves one of:
   - Bearer API key — looks up by prefix, constant-time compares SHA-256 of secret, uses the key's `tenant_id`.
   - Session cookie — verifies session, checks `memberships` to derive role + active tenant.
3. For cookie-based mutations, the `x-sa-csrf` header is compared against `sessions.csrf_token`.
4. If `requireRole` is set, the role is checked.
5. The handler runs; tenant-id is taken from the resolved context, never the request body.
6. `writeUsageLog` fires (best-effort) with method, route, status, duration.

Audit logs are written explicitly by handlers that mutate resources.

## Tenant isolation

- Every business table carries a `tenant_id uuid not null references tenants(id) on delete cascade`.
- All queries that touch these tables include `.where(eq(table.tenantId, ctx.tenantId))`. Covered by negative tests in `tests/tenant-isolation.test.ts` and `tests/api-key.test.ts`.
- Storage keys are prefixed with `tenants/<tenant-id>/`; `assertTenantOwnsKey()` guards every file fetch/delete.

## Auth model

- Password hash: argon2id (default parameters from `argon2` npm package).
- Session: 32-byte random token stored as `sha256(token)`; cookie is HTTP-only, SameSite=Lax, Secure in production, 30-day expiry (sliding via `lastSeenAt`).
- CSRF: per-session random token, set as a non-HttpOnly cookie (`sa_csrf`) and required as `x-sa-csrf` header on mutating cookie calls. SameSite=Lax already blocks cross-site form POSTs, but this adds defense in depth against XSS-controlled same-origin calls.
- API keys: format `sk_<10-char-alphanum-prefix>_<base64url-secret>`. Prefix is stored plaintext for listing and lookup; the secret portion is stored as SHA-256. Keys are revoked via `revoked_at`.

## RBAC matrix

| Capability | member | admin | owner |
| --- | --- | --- | --- |
| Read tenant data | ✓ | ✓ | ✓ |
| Write projects/records/files | ✓ | ✓ | ✓ |
| Manage API keys | | ✓ | ✓ |
| Manage members | | ✓ | ✓ |
| Promote to owner | | | ✓ |

Platform-admin is a separate flag (`users.is_platform_admin`). It has no built-in cross-tenant access in v1; treat it as a hook for future admin-console features.

## Data model quick reference

```
users ─┬─── memberships ───── tenants
       │       │
       ├─── sessions          └── projects ── records
       │                             └── files
       └─── api_keys
                                 audit_logs
                                 usage_logs
```

All `tenant_id` columns have `on delete cascade`, so deleting a tenant removes its data. User deletion sets many actor_* columns to NULL so audit trails remain intact.

## Packages

- `@storeai/shared` — no runtime deps on DB/Redis; pure types + Zod schemas + env.
- `@storeai/db` — Drizzle schema, migrations, a single shared `getDb()` (globalThis-cached).
- `@storeai/auth` — password hashing + session + api-key helpers. Talks to DB.
- `@storeai/storage` — S3 client, key helpers, tenant guard.
- `@storeai/queue` — BullMQ queues, job payloads, worker factory.

The Next.js app wires these together via `src/lib/context.ts` and `src/lib/routeHelpers.ts`. Route files are thin — they validate input, call the helper, call the DB, write audit, return.

## Build-time choices

| Choice | Why |
| --- | --- |
| pnpm workspace, not Turborepo | No remote cache needed yet; pnpm alone is enough. |
| Shared-schema multi-tenancy, not schema-per-tenant or RLS | Simpler to reason about, faster migrations, fine for v1. Enforcement lives in a single thin layer with explicit tests. |
| Cookie sessions, not JWT | Revocation is a DELETE, no token-storage problem in the browser, SameSite covers most CSRF. |
| Argon2id, not bcrypt | Modern default; memory-hard. |
| Drizzle, not Prisma | Smaller footprint, SQL-close, easy to audit the generated queries. |
| MinIO as S3 | Drop-in `@aws-sdk/client-s3`; trivial swap to AWS S3 / R2 / Spaces later. |
| BullMQ on Redis | Mature, good observability, fan-out and retry built in. |
| Single Next.js app for dashboard + API | No second HTTP layer to maintain, server actions and API routes in one place. A split only pays off at much larger scale. |
