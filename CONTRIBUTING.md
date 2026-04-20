# Contributing to StoreAI

Thanks for considering a contribution. This project is small, opinionated, and aims to stay that way — the quicker the code is to read, the easier it is for someone new (or an AI agent) to extend.

## Before you open a PR

- **Open an issue first** if the change is non-trivial (new feature, schema change, dependency upgrade, anything that touches auth or tenant isolation). A 2-line issue is enough — just avoid spending a weekend on a PR that gets declined on scope.
- **One change per PR.** A refactor + a bugfix + a new feature in one PR gets bounced. Split them.
- **No drive-by formatting.** Don't reformat files you aren't otherwise changing.

## Local dev loop

```bash
git clone https://github.com/<you>/storeai.git && cd storeai
pnpm bootstrap      # one-shot setup (installs, infra, migrate, seed)
pnpm start:all      # dev server + worker in one terminal
```

Full explanation of the commands lives in [`README.md`](./README.md).

## Tests must pass

Both suites run against real Postgres, Redis, and MinIO — no mocks — so Docker must be up.

```bash
pnpm test           # Vitest — fast, run this after any change
pnpm test:e2e       # Playwright — slower, run before pushing
```

- If you add new behavior, add a test for it. Positive test *and* a negative test if it's a permission/isolation boundary.
- If you change an existing test to make it pass, stop and think — you may be hiding a real bug.
- Tests truncate the DB between cases, so after a run, re-seed with `pnpm db:seed` if you need the admin account back.

## Branch + commit conventions

- Branch names: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- Commit messages: short imperative subject, then (optional) a body. Conventional-commit prefixes are welcome but not required.
  - Good: `fix(api): refuse owner role escalation in POST /api/members`
  - Fine: `Owners can no longer be demoted by admins`
- Don't squash-lose context — if a PR tells a story across several commits, keep them.

## Code style

The repo is TypeScript strict, formatted loosely (no Prettier config committed yet — match surrounding style). A few house rules:

- **Comments are for the *why*, not the *what*.** If the name of the thing explains itself, don't comment.
- **No dead code.** Remove it rather than commenting it out.
- **Thin route handlers, fat services.** The pattern in `apps/web/src/app/api/**/route.ts` is: parse input → call a helper → write audit log → return. If a handler is getting long, move logic into `@storeai/*`.
- **Zod at the boundaries.** Every `req.json()` / `searchParams` / env read goes through a schema.
- **Tenant filter or bust.** Any query on a tenant-scoped table MUST have `.where(eq(table.tenantId, ctx.tenantId))`. PRs without this will be rejected on sight.
- **Don't add dependencies lightly.** We already pull in a lot. If you need a new one, justify it in the PR description.

## What's in scope for v1

In scope:
- Auth, tenants, memberships, API keys, schemaless records, files via MinIO, audit + usage logs, the admin dashboard, BullMQ jobs.
- Better tests, better docs, better DX.
- Production-hardening for Ubuntu deployment.

**Out of scope for v1** (deliberately — open a discussion if you want to change this):
- Mobile SDKs.
- Firestore-style realtime subscriptions.
- Serverless edge functions / user-uploaded JS.
- A visual schema builder / rules engine.
- Per-project typed record schemas (reasonable v2 feature; not v1).

Read `BUILD_LOG.md` and `infrastructure/docs/architecture.md` for the reasoning behind existing choices.

## Reporting security issues

**Do not open a public GitHub issue for a vulnerability.** Instead:

- Email the maintainer (contact in the repo's GitHub profile), or
- Open a private GitHub security advisory on the repo (`Security` tab → `Report a vulnerability`).

Include: a description of the issue, the file + line if known, a reproducer, and the impact (e.g. cross-tenant read, privilege escalation, data loss). Expect a response within a few days — faster for actively exploited issues.

We'll credit you in the release notes for the fix unless you ask us not to.

## Licensing of contributions

By opening a PR you agree that your contribution is licensed under the project's MIT license (see [`LICENSE`](./LICENSE)). You retain copyright on your own code; you're just granting the project the right to use it.
