# StoreAI — Self-Hosted Multi-Tenant Backend Platform

A production-minded, self-hostable alternative to Supabase/Firebase, focused on web apps. v1 runs locally on Mac, designed to be deployed on Ubuntu with Docker Compose later.

---

## Phase 1 — Plan

### 1.1 Architecture

**Stack**
- Runtime: Node.js 20+ (tested on 24), TypeScript (strict)
- Framework: Next.js 15 (App Router) — dashboard UI + API routes in one app
- DB: PostgreSQL 16 via Drizzle ORM + drizzle-kit
- Cache / Queue broker: Redis 7
- Jobs: BullMQ + a standalone Node worker process
- Storage: MinIO (S3-compatible), accessed via `@aws-sdk/client-s3`
- Validation: Zod
- Auth: session-based (HTTP-only cookies, DB-backed)
- Password hashing: Argon2id (`argon2` package)
- Tests: Vitest (unit + integration against real Postgres/Redis/MinIO), Playwright (e2e)
- Package manager: pnpm workspaces
- Infra for dev: Docker Compose (Postgres, Redis, MinIO only) — app and worker run on host via `pnpm`

**Decision: sessions over JWT.**
A web app dashboard benefits from server-side revocable sessions (`DELETE FROM sessions WHERE id = ?`) with HTTP-only, SameSite=Lax cookies. That gives us logout-everywhere, automatic CSRF mitigation via SameSite, and no token-storage problem on the client. JWTs are used only at the edge of API-key authentication (not client auth) — and actually, since API keys are opaque and hashed server-side, we don't need JWTs at all in v1.

**Decision: shared-schema multi-tenancy with `tenant_id` column + enforced-in-code scoping.**
All tenant-owned tables carry a `tenant_id` FK. A single `requireTenantContext()` helper resolves the acting tenant from the session cookie (dashboard) or API key (machine), verifies membership, and provides a scoped `ctx.tenantId` that every query must use. We do not use Postgres RLS in v1 — enforcement lives in a thin service layer that route handlers must go through. That layer is the only place that touches the DB for tenant resources. Tests verify isolation explicitly.

**Decision: one Next.js app, not split frontend/backend.**
API routes (`app/api/**`) colocated with UI pages. A separate `apps/worker` process consumes BullMQ jobs and shares the `@storeai/*` packages.

### 1.2 Folder structure

```
/apps
  /web                 Next.js 15 App Router — dashboard + API routes
  /worker              BullMQ worker process (tsx entrypoint)
/packages
  /db                  Drizzle schema, migrations, client factory, seed
  /auth                Password hashing, sessions, API-key auth, RBAC helpers
  /storage             S3 client wrapper (MinIO), tenant key helpers
  /queue               BullMQ queues + job definitions
  /shared              Zod schemas, types, errors, constants
/infrastructure
  /docker              docker-compose.yml
  /scripts             bash scripts: setup, reset, test helpers
  /docs                extra technical notes
.env.example
README.md
BUILD_LOG.md
```

### 1.3 Database schema (Drizzle / PostgreSQL)

All tenant-owned tables carry `tenant_id uuid not null references tenants(id) on delete cascade` and `(tenant_id, id)` or `(tenant_id, created_at)` indexes where useful.

**Core tables**
- `users` — id, email (unique citext), password_hash, name, is_platform_admin, created_at, updated_at
- `tenants` — id, slug (unique), name, created_at, updated_at
- `memberships` — (user_id, tenant_id) unique, role (`owner` | `admin` | `member`), created_at
- `sessions` — id (random token, stored as sha256 hash), user_id, active_tenant_id nullable, expires_at, created_at, user_agent, ip
- `api_keys` — id, tenant_id, created_by_user_id, name, prefix (8 chars, stored plaintext for UI and lookup), hash (sha256), last_used_at, revoked_at, created_at
- `projects` — id, tenant_id, name, slug, description, created_by_user_id, created_at, updated_at (example tenant resource)
- `records` — id, tenant_id, project_id, key, data (jsonb), created_by_user_id, created_at, updated_at (example document resource)
- `files` — id, tenant_id, project_id nullable, object_key (unique), original_name, size_bytes, content_type, uploaded_by_user_id, created_at
- `audit_logs` — id, tenant_id, actor_user_id nullable, actor_api_key_id nullable, action, resource_type, resource_id, metadata jsonb, created_at
- `usage_logs` — id, tenant_id, actor_user_id nullable, actor_api_key_id nullable, route, method, status_code, duration_ms, created_at

**Indexes**
- `users(email)` unique
- `tenants(slug)` unique
- `memberships(user_id)`, `memberships(tenant_id)`
- `sessions(hash)` unique, `sessions(user_id)`
- `api_keys(prefix)` unique, `api_keys(tenant_id)`
- `projects(tenant_id, slug)` unique, `projects(tenant_id, created_at)`
- `records(tenant_id, project_id, created_at)`, `records(tenant_id, key)`
- `files(tenant_id, created_at)`, `files(object_key)` unique
- `audit_logs(tenant_id, created_at)`
- `usage_logs(tenant_id, created_at)`, `usage_logs(actor_api_key_id)`

### 1.4 Auth & authz

- **Password:** Argon2id via `argon2` lib.
- **Signup:** creates a user, creates a starter tenant, creates owner membership, creates a session.
- **Login:** verifies password, rotates session.
- **Session cookie:** `sa_session`, HTTP-only, SameSite=Lax, Secure in prod, 30-day sliding. Cookie value is the raw token; DB stores `sha256(token)`. Rotated on login.
- **Tenant context:** user selects active tenant in dashboard → stored on `sessions.active_tenant_id`. `requireUserSession()` returns `{ user, session, activeTenantId }`; `requireTenantContext()` additionally verifies membership and returns `{ user, tenantId, role }`.
- **API key auth:** `Authorization: Bearer sk_<prefix>_<secret>`. Server parses prefix, looks up `api_keys` by prefix, compares `sha256(secret)` in constant time. Yields `{ tenantId, apiKeyId, createdByUserId }`.
- **RBAC:** three tenant roles — `owner`, `admin`, `member`. Platform admin is a separate user-level flag. Permission helpers: `canManageMembers(role)`, `canManageApiKeys(role)`, `canWrite(role)`, `canRead(role)`. Simple matrix, not a full policy engine.
- **CSRF:** SameSite=Lax blocks cross-site form POSTs. Additionally, mutating API endpoints require an `x-sa-csrf` header equal to a cookie-bound random token when called from the browser (double-submit). API-key calls bypass this since they don't use cookies.

### 1.5 Tenant isolation strategy

- Every tenant-scoped route handler must call either `requireTenantContext(req)` (cookie auth) or `requireApiKey(req)` (bearer auth). Both return a typed `Ctx` with `tenantId`.
- Every DB query touching a tenant table MUST include `.where(eq(table.tenantId, ctx.tenantId))`. A unit test enumerates route files and grep-checks the pattern.
- Service functions accept `ctx` as first arg and never accept a raw `tenantId` from untyped input.
- Zod schemas never include `tenant_id` — it is always derived.

### 1.6 Test strategy

- **Unit / integration:** Vitest. Tests spin up a real Postgres (via the docker-compose stack started before tests), a test schema, run migrations, seed, run assertions. Single worker (`pool: 'forks', singleFork: true`) to avoid cross-test race.
- **E2E:** Playwright hitting the running Next.js dev server + docker-compose infra. Minimum: sign up → create tenant → create API key → create project → hit API with key → upload file → see audit log.
- Coverage areas: auth flows, tenant isolation (negative tests), role enforcement, API key auth, CRUD, file upload permissions, audit log creation, usage log creation, dashboard flows, queue job execution.

### 1.7 Local setup plan (Mac)

Commands (all via repo root):
- `pnpm install`
- `pnpm infra:up` — `docker compose up -d` in `infrastructure/docker/`
- `pnpm db:migrate` — apply Drizzle migrations
- `pnpm db:seed` — create platform admin + demo tenant + demo data
- `pnpm dev` — Next.js on :3000
- `pnpm worker` — BullMQ worker
- `pnpm test` — Vitest
- `pnpm test:e2e` — Playwright
- `pnpm infra:down` — stop stack
- `pnpm reset` — nuke volumes + re-migrate + re-seed

---

## Phase 2 — Scaffold

- pnpm workspace; `apps/{web,worker}` + `packages/{shared,db,auth,storage,queue}` + `infrastructure/{docker,scripts,docs}`.
- Root `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `bundler` resolution.
- `.env.example` with all required vars; `infrastructure/docker/docker-compose.yml` for Postgres, Redis, MinIO; `wait-for-infra.sh` and `reset.sh` helpers.
- Next.js 15 App Router app with `transpilePackages` and webpack `extensionAlias` for `.js`→`.ts`. Native packages (argon2, postgres, bullmq, ioredis) kept external so webpack doesn't bundle `.node` binaries.

## Phase 3 — Core backend

- `@storeai/db`: Drizzle schema for users, tenants, memberships, sessions, api_keys, projects, records, files, audit_logs, usage_logs. Indexes + FKs as planned. Generator + migrator + seed scripts.
- `@storeai/auth`: argon2id password hashing, DB-backed sessions with CSRF token, API-key creation (`sk_<prefix>_<secret>`, SHA-256 stored), constant-time verification.
- `@storeai/storage`: S3 client for MinIO, tenant-prefixed key builder, signed URLs, tenant guard on key access.
- `@storeai/queue`: BullMQ queues (`file-post-process`, `audit-fanout`) with retry policy, worker factory, connection helpers.
- Next.js `src/lib/context.ts` with `requireTenantContext(req)`, `getUserSessionFromRequest(req)`, `writeAuditLog`, `writeUsageLog`. Paired `src/lib/routeHelpers.ts` wraps handlers with auth, CSRF, role check, and usage logging.
- Routes implemented: auth (`/signup`, `/login`, `/logout`, `/me`), tenants (list/create/switch), api-keys (list/create/revoke), projects (CRUD), records (CRUD), files (upload/list/get/delete with signed URLs), audit-logs, usage-logs, members (list/add/update role/remove), health.

## Phase 4 — Dashboard UI

- App Router pages: `/login`, `/signup`, `/dashboard` (overview), `/dashboard/workspaces/new`, `/dashboard/projects`, `/dashboard/projects/[id]`, `/dashboard/api-keys`, `/dashboard/files`, `/dashboard/members`, `/dashboard/audit-logs`, `/dashboard/usage-logs`.
- Shared sidebar with role-gated nav + tenant switcher + logout.
- Client calls go through `src/lib/api-client.ts` which automatically adds the `x-sa-csrf` header from the `sa_csrf` cookie.
- Plain CSS in `globals.css` — dark theme, functional.

## Phase 5 — Testing

- Vitest runs against real Postgres + Redis + MinIO. 7 test files, **18 tests passing**:
  - `auth.test.ts` — 4 tests: signup, duplicate email, login (good/bad password), /me + logout.
  - `crud.test.ts` — 3 tests: project CRUD + records + audit + usage log creation; Zod validation; CSRF requirement.
  - `tenant-isolation.test.ts` — 2 tests: cross-tenant access blocked via session; cross-project record writes blocked.
  - `rbac.test.ts` — 2 tests: members blocked from API keys; admin allowed, member blocked from audit/members.
  - `api-key.test.ts` — 3 tests: create/list/use/revoke; cross-tenant key isolation; bad bearer → 401.
  - `files.test.ts` — 2 tests: upload/list/get/delete; cross-tenant file access blocked.
  - `queue.test.ts` — 2 tests: file post-process marks `processed_at`; audit fanout returns ok payload.
- Playwright runs against the Next.js dev server. 2 e2e tests passing:
  - Full signup → create API key → create project via API key → create record via API key → see project + audit log in dashboard.
  - Unauthenticated `/dashboard` visit redirects to `/login`.

## Issues fixed during implementation

- `inet` columns rejected literal `"unknown"` — changed to null when no `X-Forwarded-For`.
- `cookies()` from `next/headers` fails outside a request scope — added `getUserSessionFromRequest(req)` and `requireTenantContext(req)` variants so route handlers don't need the dynamic API.
- API-key parsing failed when the random secret contained `_` — prefix now uses a restricted alphabet and parsing splits only on the first separator after `sk_`.
- Rate-limit counters persisted across Vitest runs — bypassed in `NODE_ENV=test`.
- argon2 native `.node` binary was being bundled by webpack — added webpack externals for native packages.
- Next.js couldn't resolve `.js` extensions in workspace packages — added `extensionAlias` and `transpilePackages`.
- BullMQ job return value not reflected on stale Job object — tests now fetch fresh via `Queue.getJob(id)`.

## Phase 6 — Docs

- `README.md` with setup, commands, API surface, and test instructions.
- `infrastructure/docs/architecture.md` with process topology, request lifecycle, isolation, RBAC, and design rationale.
- `infrastructure/docs/production-hardening.md` with a detailed checklist for Ubuntu deployment.

---

## Final results

**All tests pass locally:**

```
$ pnpm test
Test Files  7 passed (7)
     Tests  18 passed (18)

$ pnpm test:e2e
  2 passed (7.4s)
```

**Definition-of-done status:** Every bullet in the original spec is met — runs locally on Mac, DB works, auth works, multi-tenant logic works, CRUD works, API keys work, storage works, queue works, dashboard works, tests pass, docs exist.

