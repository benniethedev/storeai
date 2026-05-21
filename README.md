# StoreAI

A self-hosted, multi-tenant backend platform for web apps and AI agents. Supabase/Firebase-style feature set — auth, workspaces, API keys, CRUD APIs, file storage, background jobs, audit + usage logs, deploy visibility, and an admin dashboard — all in one Next.js app backed by PostgreSQL, Redis, and MinIO.

**Status:** v1 runs locally on macOS and passes 21 Vitest integration tests + 2 Playwright e2e tests. Designed to be self-hostable on Ubuntu via Docker Compose.

- **Repo:** https://github.com/benniethedev/storeai
- **License:** MIT (see `LICENSE`)
- **Contributing:** see `CONTRIBUTING.md`

---

## What's in here

```
apps/
  web                # Next.js 15 app (dashboard + /api routes)
  realtime           # WebSocket event stream for agents and dashboards
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
pnpm dev:all        # runs the Next.js dev server + worker (loopback-only)
```

That's it — open http://localhost:3000 and sign in with the credentials the wizard printed at the end of `pnpm bootstrap` (or set your own interactively).

> **The dev and production servers bind to `127.0.0.1` by default.** Public exposure is an explicit opt-in (`HOST=0.0.0.0 pnpm start`) and should only ever be used behind a reverse proxy. When you have a domain, skip straight to **[Deploy with a custom domain + HTTPS](#deploy-with-a-custom-domain--https)** — `pnpm deploy:domain` installs Caddy, issues a Let's Encrypt cert, sets up UFW default-deny, and runs the app as a hardened `storeai` system user. For a quick VPS preview without a domain, tunnel over SSH — see [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md#preview-a-vps-without-exposing-it).

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

> **The credentials to use are whatever `pnpm bootstrap` printed at the end of its run.** `pnpm db:seed` refuses to run against a weak placeholder, so the default `admin/admin12345` combo no longer exists. The wizard always prints the live email + password from your `.env`; if you lose them, just re-run `pnpm bootstrap` (idempotent) and it'll either show you what's in `.env` or regenerate a placeholder password.

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
| `pnpm dev` | Next.js **dev** server on 127.0.0.1:3000 (HMR — local dev only) |
| `pnpm dev:all` | Dev server + worker together. Refuses to run if `NODE_ENV=production`. |
| `pnpm build` | Build the Next.js **production** bundle (required before `pnpm start`) |
| `pnpm start` | Run the production server on 127.0.0.1:3000 (run `pnpm build` first) |
| `pnpm start:all` | Production web + worker together (same binary systemd would run) |
| `pnpm worker` | BullMQ worker in dev mode |
| `pnpm worker:start` | BullMQ worker in production mode |
| `pnpm realtime` | Realtime WebSocket server on 127.0.0.1:3010 |
| `pnpm realtime:start` | Realtime WebSocket server in production mode |
| `pnpm deploy:domain` | Attach a custom domain + Let's Encrypt HTTPS on Ubuntu/Debian (installs Caddy, writes systemd units, sets UFW default-deny) |
| `pnpm test` | Run Vitest integration suite |
| `pnpm test:e2e` | Run Playwright end-to-end tests |
| `pnpm reset` | Wipe volumes + re-migrate + re-seed (prints the seeded creds at the end) |
| `pnpm clean` | Nuclear wipe: volumes, `.next`, build caches (keeps `.env`) |
| `pnpm admin:reset-password --email a@b.c --password pw` | Rotate any user's password without wiping the DB |

## Architecture at a glance

- **Auth:** session cookies (HTTP-only, SameSite=Lax), DB-backed, argon2id passwords, CSRF token via `x-sa-csrf` header on mutations.
- **API keys:** `sk_<prefix>_<secret>`; only the secret's SHA-256 is stored; prefix is used for lookup and listing. Shown once.
- **Multi-tenancy:** shared-schema. Every tenant-owned table has a `tenant_id` FK. All route handlers go through `requireTenantContext()` / `tenantRoute()` which verifies membership and injects a scoped context; every query filters by `ctx.tenantId`.
- **RBAC:** three tenant roles — `owner` > `admin` > `member` — plus a platform-admin user flag. See `packages/shared/src/roles.ts`.
- **Storage:** MinIO with a single bucket; object keys are `tenants/<tenantId>/<projects/<projectId>>/<date>/<rand>-<name>`, enforced on access.
- **Jobs:** BullMQ on Redis. Two example queues shipped: file post-processing (marks `files.processed_at`) and audit fanout.
- **Validation:** Zod on every `body`, `searchParams`, and env var.
- **Agent contract:** `/api/openapi.json` exposes a machine-readable API summary for local and hosted agents.

## HTTP API

All endpoints live under `/api`. Cookie-authenticated calls require the `x-sa-csrf` header on mutations. Bearer API keys bypass CSRF.

Mutating API calls may include `Idempotency-Key: <stable-key>`. StoreAI will replay the first successful JSON response for the same tenant, route, method, and key, which makes agent/client retries safe.

Records include a monotonically increasing `version`. Updates may include `If-Match: <version>` or `x-storeai-record-version: <version>` to reject stale writes with `409 version_conflict`.

Every project, record, and file mutation writes a durable tenant event. Poll `/api/events` or use the realtime service to watch changes.

Admins can export a tenant backup with `GET /api/export`. The export includes projects, records, file metadata, events, audit logs, and usage logs. File bytes remain in S3/MinIO and should be backed up at the object-storage layer.

Realtime runs as a separate WebSocket process. In production Caddy exposes it at `wss://<domain>/realtime`; locally it listens on `ws://127.0.0.1:3010`. Connect, send `{"type":"auth","token":"<api-key>","lastEventId":"optional-event-id"}`, then listen for `{"type":"event","event":...}` messages. Scoped keys need `realtime:connect`; legacy full-access keys keep working.

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/auth/signup` | POST | public |
| `/api/auth/login` | POST | public |
| `/api/auth/logout` | POST | session |
| `/api/auth/me` | GET | session |
| `/api/openapi.json` | GET | public |
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
| `/api/export` | GET | session (admin) |
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

### Limits

| Limit | Value |
| --- | --- |
| Max file upload | 50 MB |
| Max record `data` (JSON, serialized) | 1 MB |
| Max record `key` length | 120 chars |
| `?key=` / `?keyPrefix=` query param length | 255 chars |

Clients that exceed the per-record `data` limit get HTTP `413` with code `record_too_large`. See `docs/API.md` for full details, including filter params (`?key=`, `?keyPrefix=`) on `/api/records` and the `downloadUrl` returned by `POST /api/files`.

### Large content strategy

StoreAI is designed around small operational records, plus separate files for larger blobs.

- Keep records lean: indexes, settings, session state, usage counters, and task metadata should stay inline.
- Put long-form content in files: prompts, transcripts, generated reports, exports, attachments, and logs belong in `/api/files`.
- Store a pointer in the record: save the returned `fileId` and any small metadata you need, rather than embedding the whole blob into `record.data`.
- This keeps projects usable for many app shapes without inflating the core record size limit.

## Tests

```bash
pnpm test       # Vitest — 21 integration tests against real Postgres/Redis/MinIO
pnpm test:e2e   # Playwright — full signup → API key → CRUD flow in the browser
```

See `apps/web/tests/` for the suites. Covered areas: auth flows, tenant isolation, RBAC, API key auth + revocation, CRUD, file upload permissions, audit/usage log creation, queue job execution, member owner-protection, dashboard flows.

## Agent integration

StoreAI is intentionally small enough for local agents to use directly. Give an agent a tenant API key, point it at your StoreAI base URL, and let it read `/api/openapi.json` before making calls.

Recommended agent behavior:

- Store small operational state in records.
- Store large prompts, transcripts, attachments, reports, and logs in files.
- Use stable record keys so retries and follow-up tasks can find the same data.
- Keep tenant API keys private and rotate/revoke them from the dashboard when a project is done.

## Troubleshooting

### "Invalid email or password" right after `pnpm bootstrap`

The wizard prints the live credentials at the end. If you missed them:

```bash
grep '^SEED_ADMIN_' .env        # shows exactly what the seed wrote into the DB
```

Those are always the source of truth — the seed script rotates the DB to match on every run.

### I signed up through the UI and forgot the password

No full reset needed. Rotate just that user:

```bash
pnpm admin:reset-password --email you@example.com --password 'newpass1234'
```

### `pnpm build` fails or the app behaves weirdly after an update

```bash
pnpm clean           # nuke volumes + .next + caches (keeps .env)
pnpm bootstrap       # fresh infra + migrate + seed
```

### Can't reach the app from a browser on a VPS

1. Is the app listening on `0.0.0.0`? → `ss -ltnp | grep :3000`
2. Is UFW blocking it? → `sudo ufw status`; `sudo ufw allow 3000/tcp`
3. Is your cloud provider's firewall / security group blocking it? (UFW ≠ cloud firewall)
4. Does `curl -I http://localhost:3000/api/health` work *on the VPS itself*? If yes, it's a network-perimeter issue; if no, check the dev server logs.

### Docker daemon not running

```bash
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
newgrp docker
```

## Deploy with a custom domain + HTTPS

Once your Ubuntu/Debian host is up and `pnpm bootstrap` has run, one command attaches a domain, installs Caddy, auto-provisions a Let's Encrypt cert, switches the app into production mode, and registers systemd services so everything restarts on reboot:

```bash
pnpm deploy:domain --domain app.example.com --email you@example.com
```

What it does (idempotent — safe to re-run):

1. Preflights OS (Ubuntu/Debian), tooling, that your DNS A record points at this server, and that ports 80/443 are free.
2. Installs Caddy from the official apt repo if it isn't already there.
3. Renders `/etc/caddy/Caddyfile` from `infrastructure/caddy/Caddyfile.example` with your domain + ACME email (HTTP/2, gzip/zstd, HSTS + basic security headers).
4. Updates `.env`: `HOST=localhost`, `APP_URL=https://<your-domain>`, `NODE_ENV=production` — the app is no longer directly exposed; Caddy is the only thing on the public internet.
5. Runs `pnpm build` to produce the production bundle.
6. Installs two systemd units — `storeai-web.service` and `storeai-worker.service` — rendered from `infrastructure/systemd/*.example`, wired to the current user and absolute pnpm path.
7. Opens 80/443 in UFW and closes 3000 if it was previously open. Warns you about any non-UFW firewall (cloud security group).
8. Enables + starts the services, reloads Caddy, and curls `https://<your-domain>/api/health` to confirm it's up.

Flags: `--yes` to skip confirmation prompts, `--dry-run` to print what would happen without making changes, `--help` for the header.

After it finishes:

```bash
sudo systemctl status storeai-web
sudo systemctl status storeai-worker
sudo journalctl -u caddy -f          # watch cert issuance or reload
```

**Before you run it:** create an A record for `<your-domain>` pointing at the server's public IP, and make sure ports 80 and 443 are open in your cloud provider's firewall/security group (not just UFW).

If anything's off (DNS wrong, port 80 held by Apache, etc.) the script fails loudly before changing anything important.

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

- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — consolidated deploy guide (local, VPS-by-IP, full production, self-managed proxy, troubleshooting)
- [`BUILD_LOG.md`](./BUILD_LOG.md) — the full design plan and what was built each phase
- [`.env.example`](./.env.example) — all environment variables
- [`infrastructure/docs/architecture.md`](./infrastructure/docs/architecture.md) — architecture deep-dive
- [`infrastructure/docs/production-hardening.md`](./infrastructure/docs/production-hardening.md) — Ubuntu deployment checklist
