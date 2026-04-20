# StoreAI

A self-hosted, multi-tenant backend platform for web apps. Supabase/Firebase-style feature set — auth, workspaces, API keys, CRUD APIs, file storage, background jobs, audit + usage logs, and an admin dashboard — all in one Next.js app backed by PostgreSQL, Redis, and MinIO.

**Status:** v1 runs locally on macOS and passes 21 Vitest integration tests + 2 Playwright e2e tests. Designed to be self-hostable on Ubuntu via Docker Compose.

- **Repo:** https://github.com/benniethedev/storeai
- **License:** MIT (see `LICENSE`)
- **Contributing:** see `CONTRIBUTING.md`

---

## What's in here

```
apps/
  web                # Next.js 15 app (dashboard + /api routes)
  worker             # BullMQ worker process
packages/
  shared             # Zod schemas, env, errors, RBAC helpers
  db                 # Drizzle schema, migrations, seed
  auth               # Passwords (argon2id), sessions, API keys
  storage            # MinIO / S3 wrapper
  queue              # BullMQ queues, jobs, worker factory
infrastructure/
  docker             # docker-compose.yml (Postgres, Redis, MinIO)
  scripts            # wait-for-infra.sh, reset.sh
```

## Prerequisites

- **OS:** macOS or Linux (developed on macOS Darwin 24.5; production target is Ubuntu — see `infrastructure/docs/production-hardening.md`)
- **Node.js 20+** (tested on 24.1)
- **pnpm 10+**
- **Docker** with the Compose v2 plugin
  - macOS: Docker Desktop
  - Ubuntu: `docker-ce` + `docker-compose-plugin` (the `docker compose` CLI is identical)

> Nothing in the stack is mac-specific. The same commands work on an Ubuntu server.

## First-time setup

**One command — clone, bootstrap, run:**

```bash
git clone https://github.com/benniethedev/storeai.git && cd storeai
pnpm bootstrap      # installs deps, starts Postgres/Redis/MinIO, migrates, seeds
pnpm start:all      # runs the Next.js app + the BullMQ worker together
```

That's it — open http://localhost:3000 and sign in with the credentials the wizard printed at the end of `pnpm bootstrap` (or set your own interactively).

<details>
<summary>What <code>pnpm bootstrap</code> does (the old 5-step flow, automated)</summary>

1. Preflight-checks Node 20+, pnpm, Docker, and a running Docker daemon
2. Copies `.env.example` → `.env` if missing
3. Generates a strong random `AUTH_SECRET` (the example default is only a placeholder)
4. `pnpm install`
5. `docker compose up -d` for Postgres, Redis, MinIO, and waits until all three are healthy
6. Applies Drizzle migrations
7. Seeds the demo admin + workspace

Re-running `pnpm bootstrap` is safe — it skips anything that's already done.

If you'd rather run the steps by hand:

```bash
pnpm install
cp .env.example .env
pnpm infra:up && pnpm infra:wait
pnpm db:migrate && pnpm db:seed
pnpm dev             # in one terminal
pnpm worker          # in another
```
</details>

> The old defaults (`admin@storeai.local` / `admin12345`) no longer exist — `pnpm db:seed` refuses to run against a weak placeholder password. Use whatever the wizard set for you (or whatever you put in `SEED_ADMIN_PASSWORD`).

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm infra:up` | Start Postgres, Redis, MinIO via Docker Compose |
| `pnpm infra:down` | Stop them (keeps data) |
| `pnpm infra:wait` | Block until all three are healthy |
| `pnpm db:generate` | Regenerate Drizzle migration SQL from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed admin user + demo workspace |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm dev` | Run Next.js dev server on :3000 |
| `pnpm worker` | Run the BullMQ worker |
| `pnpm test` | Run Vitest integration suite |
| `pnpm test:e2e` | Run Playwright end-to-end tests |
| `pnpm reset` | Wipe volumes + re-migrate + re-seed |

## Architecture at a glance

- **Auth:** session cookies (HTTP-only, SameSite=Lax), DB-backed, argon2id passwords, CSRF token via `x-sa-csrf` header on mutations.
- **API keys:** `sk_<prefix>_<secret>`; only the secret's SHA-256 is stored; prefix is used for lookup and listing. Shown once.
- **Multi-tenancy:** shared-schema. Every tenant-owned table has a `tenant_id` FK. All route handlers go through `requireTenantContext()` / `tenantRoute()` which verifies membership and injects a scoped context; every query filters by `ctx.tenantId`.
- **RBAC:** three tenant roles — `owner` > `admin` > `member` — plus a platform-admin user flag. See `packages/shared/src/roles.ts`.
- **Storage:** MinIO with a single bucket; object keys are `tenants/<tenantId>/<projects/<projectId>>/<date>/<rand>-<name>`, enforced on access.
- **Jobs:** BullMQ on Redis. Two example queues shipped: file post-processing (marks `files.processed_at`) and audit fanout.
- **Validation:** Zod on every `body`, `searchParams`, and env var.

## HTTP API

All endpoints live under `/api`. Cookie-authenticated calls require the `x-sa-csrf` header on mutations. Bearer API keys bypass CSRF.

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/auth/signup` | POST | public |
| `/api/auth/login` | POST | public |
| `/api/auth/logout` | POST | session |
| `/api/auth/me` | GET | session |
| `/api/tenants` | GET, POST | session |
| `/api/tenants/switch` | POST | session |
| `/api/api-keys` | GET, POST | session (admin) |
| `/api/api-keys/:id` | DELETE | session (admin) |
| `/api/projects` | GET, POST | session OR api-key |
| `/api/projects/:id` | GET, PATCH, DELETE | session OR api-key |
| `/api/records` | GET, POST | session OR api-key |
| `/api/records/:id` | GET, PATCH, DELETE | session OR api-key |
| `/api/files` | GET, POST (multipart) | session OR api-key |
| `/api/files/:id` | GET, DELETE | session OR api-key |
| `/api/members` | GET, POST | session (admin) |
| `/api/members/:id` | PATCH, DELETE | session (admin) |
| `/api/audit-logs` | GET | session (admin) |
| `/api/usage-logs` | GET | session (admin) |
| `/api/health` | GET | public |

Example (API-key call):

```bash
curl -H "Authorization: Bearer $KEY" \
     -H "Content-Type: application/json" \
     -d '{"name":"Alpha","slug":"alpha"}' \
     http://localhost:3000/api/projects
```

## Tests

```bash
pnpm test       # Vitest — 21 integration tests against real Postgres/Redis/MinIO
pnpm test:e2e   # Playwright — full signup → API key → CRUD flow in the browser
```

See `apps/web/tests/` for the suites. Covered areas: auth flows, tenant isolation, RBAC, API key auth + revocation, CRUD, file upload permissions, audit/usage log creation, queue job execution, member owner-protection, dashboard flows.

## Contributing

PRs welcome. Short version:

1. Fork → create a branch off `main` (`feat/…`, `fix/…`, `docs/…`).
2. `pnpm bootstrap` once, then `pnpm test` + `pnpm test:e2e` before pushing — both suites must pass.
3. Keep the change small and scoped; open an issue first if it's anywhere near "redesign".
4. Open a PR with a brief description of **what** and **why** (the diff shows the how).

Full guidelines, test conventions, and the non-goals for v1 are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Found a security issue? Don't open a public issue — see the "Reporting security issues" section in `CONTRIBUTING.md`.

## License

MIT — see [`LICENSE`](./LICENSE). You can use this commercially, modify it, and self-host it. Attribution appreciated but not required.

## See also

- [`BUILD_LOG.md`](./BUILD_LOG.md) — the full design plan and what was built each phase
- [`.env.example`](./.env.example) — all environment variables
- [`infrastructure/docs/architecture.md`](./infrastructure/docs/architecture.md) — architecture deep-dive
- [`infrastructure/docs/production-hardening.md`](./infrastructure/docs/production-hardening.md) — Ubuntu deployment checklist
