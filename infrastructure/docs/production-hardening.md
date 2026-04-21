# Production hardening checklist

v1 is designed to run locally; this is what to do before turning it loose on the open internet.

## Secrets and environment

- Generate a real `AUTH_SECRET` (32+ bytes random, base64).
- Rotate `POSTGRES_PASSWORD`, `S3_SECRET_KEY` away from defaults.
- Store secrets in a vault (sops, AWS Secrets Manager, 1Password CLI, etc.), not committed `.env`.
- Set `NODE_ENV=production` so cookies become `Secure`.

## TLS and reverse proxy

- Put Nginx / Caddy / Traefik in front with Let's Encrypt.
- Force HTTPS; enable HSTS once traffic is stable.
- Terminate TLS at the proxy; set `X-Forwarded-For` and `X-Forwarded-Proto` so rate-limiting uses real client IPs.

## Postgres

- Take daily snapshots (`pg_dump` or managed-service backup).
- Move to a managed Postgres (RDS / Cloud SQL / Neon) or run on a dedicated host with persistent disk.
- Set connection limits (pgbouncer in transaction mode is a good fit).
- Turn on slow-query logging.

## Redis

- Enable persistence (AOF) or accept that jobs can be lost on restart.
- Put it on a private network; do not expose 6379.
- Consider a managed Redis; the queue semantics rely on it being durable.

## MinIO / S3

- Either stay on MinIO behind TLS on its own host, or switch to AWS S3 / Cloudflare R2 / DigitalOcean Spaces.
- Turn on versioning if deletes should be recoverable.
- Add a bucket lifecycle policy to expire orphaned objects.
- Set CORS for the final public frontend domain only.

## Rate limiting

v1 ships a lightweight fixed-window Redis limiter on signup + login. Before production:
- Add limits to API-key endpoints and file upload.
- Consider an edge layer (Cloudflare, a dedicated WAF).
- Per-tenant usage caps backed by `usage_logs`.

## Monitoring & alerting

- Wire `pino` or OpenTelemetry into the route helpers.
- Ship usage_logs to a long-term store (ClickHouse, BigQuery) if retention grows.
- Alert on 5xx spikes and on BullMQ `failed` counts.

## Background worker

- Run the worker as a separate systemd service / container replica.
- Scale horizontally; BullMQ handles distribution automatically.
- Add a dead-letter handling path — `failed` jobs currently just log.

## Security

- Enable HTTP security headers (`Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`). Next.js middleware is the easy place.
- Add a proper invite flow (email-verified tokens) before removing the "user must already exist" restriction on `/api/members`.
- Consider SSO (OIDC) for tenant-owner bootstrap.
- Add virus scanning to the file post-processing worker.
- Review `.next/standalone` output for secrets before shipping images.

## Deployment shape (Ubuntu)

Suggested layout:
```
/opt/storeai
├─ docker-compose.prod.yml   # web + worker + nginx; Postgres/Redis/MinIO pinned to volumes
├─ .env                      # filled from secret manager at boot
└─ data/                     # bind-mounted volumes
```

- `docker compose pull && docker compose up -d` for deploys.
- Add a systemd unit wrapping `docker compose` so the stack restarts on boot.
- Backup routine: nightly `pg_dump` + MinIO `mc mirror` to offsite storage.

## Network configuration

### Dev mode vs. production mode

Both scripts now bind to `0.0.0.0` by default (override with `HOST=localhost` if you only want loopback access):

| Command | Mode | Requires prior build? | When to use |
| --- | --- | --- | --- |
| `pnpm dev` | Next.js dev server (HMR, source maps) | No | Local development only — never in production |
| `pnpm build && pnpm start` | Next.js production server | **Yes** | Staging / production |

`pnpm start` without a preceding `pnpm build` will fail with "could not find a production build". The dev server is slower, leaks stack traces on errors, and has no caching — don't expose it to the public internet.

### Firewall

If UFW is enabled on the host (Ubuntu's default):

```bash
# Direct port access (OK for staging)
sudo ufw allow 3000/tcp comment 'StoreAI'

# Behind a reverse proxy on 80/443 (recommended for prod)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3000/tcp     # keep the app port closed to the public
```

### Cloud provider security groups

On AWS / GCP / Azure / DigitalOcean, the VPC firewall is separate from UFW. Open the same ports there — inbound from `0.0.0.0/0` to your HTTP/HTTPS ports, and nothing else (especially not 5432, 6379, 9002).

### Reverse proxy (recommended)

Put Caddy / Nginx / Traefik in front so the app listens on `localhost:3000` behind TLS on 443. A minimal Caddyfile:

```
app.example.com {
  reverse_proxy localhost:3000
}
```

With a reverse proxy you should also set `HOST=localhost` in the app's env so Next.js only binds to loopback — no need to expose port 3000 at all.

## Known v1 limitations

- No email invites — admins must add members who already have accounts.
- Rate limiting is in-process and simple; not suitable for global enforcement.
- No multi-region story for storage.
- No row-level security in Postgres — all isolation is application-enforced. Tests cover this but an RLS layer would give defense in depth.
- The worker has no retry tuning beyond BullMQ defaults (3 attempts, exponential).
- No webhook delivery yet; the schema allows for `webhooks` but the v1 scope deliberately cut this.
- File uploads are capped at 50 MB and go through the Node process. For larger files, switch to presigned-upload URLs (helpers already exist in `@storeai/storage`).
