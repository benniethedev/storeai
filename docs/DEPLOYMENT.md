# Deploying StoreAI

This is the one-page "get it running" guide. For the full design rationale see [`../infrastructure/docs/architecture.md`](../infrastructure/docs/architecture.md); for the production security + ops checklist see [`../infrastructure/docs/production-hardening.md`](../infrastructure/docs/production-hardening.md).

---

## Paths

Pick one:

| You have… | Use… |
| --- | --- |
| A laptop and want to try it locally | [Local dev](#local-dev) |
| A fresh Ubuntu VPS + a domain name | [Full production (Caddy + Let's Encrypt)](#full-production-deploy) |
| A fresh Ubuntu VPS, **no** domain yet, just want external IP access | [IP-only dev on a VPS](#ip-only-dev-on-a-vps) |
| An existing server with your own reverse proxy (Nginx/Traefik) | [Self-managed reverse proxy](#self-managed-reverse-proxy) |

---

## Local dev

One box, localhost only, dev server (hot reload).

```bash
git clone https://github.com/benniethedev/storeai.git && cd storeai
pnpm bootstrap      # installs deps, starts Postgres/Redis/MinIO, migrates, seeds
pnpm start:all      # runs web + worker together
```

Open <http://localhost:3000>. Credentials are printed at the end of `pnpm bootstrap`.

---

## IP-only dev on a VPS

Fine for testing before you have a domain. **Not for public production** — you'll be running `pnpm dev` without TLS.

```bash
# 1. Install prerequisites (one-time)
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
curl -fsSL https://fnm.vercel.app/install | bash && exec $SHELL
fnm install 20 && fnm default 20
npm i -g pnpm

# 2. Clone + bootstrap
git clone https://github.com/benniethedev/storeai.git && cd storeai
pnpm bootstrap

# 3. Open port 3000
sudo ufw allow 3000/tcp
#   and also open it in your cloud provider's firewall / security group

# 4. Run the dev server
pnpm dev
```

Open `http://<vps-ip>:3000`. When you're ready to switch to real production, go to [Full production deploy](#full-production-deploy).

---

## Full production deploy

Attach a domain + HTTPS + process supervisor + hardened Caddy in one command.

### Prerequisites

1. Ubuntu/Debian 22.04+
2. A domain name pointed at the server's public IP (create an **A record**: `app.example.com → <vps-ip>`)
3. Ports **80 and 443** open in BOTH:
   - The host firewall: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`
   - Your cloud provider's firewall / security group (AWS SG, GCP VPC, OVH firewall panel, etc.)
4. The repo cloned and `pnpm bootstrap` completed successfully

### Deploy

```bash
cd ~/storeai
pnpm deploy:domain --domain app.example.com --email you@example.com
```

What this does (idempotent — safe to re-run):

1. Preflights OS, tooling, DNS (must resolve to this host), and that ports 80/443 are free
2. Installs Caddy from the official apt repo if missing
3. Renders `/etc/caddy/Caddyfile` with HSTS, HTTP/2, gzip/zstd, security headers, and **an edge probe-path block** (404s scanner traffic before it hits Node)
4. Updates `.env`: `HOST=localhost`, `APP_URL=https://<domain>`, `NODE_ENV=production`
5. Runs `pnpm build`
6. Installs two systemd units (`storeai-web.service`, `storeai-worker.service`) with `Restart=always` and crash-loop backoff
7. Opens 80/443 in UFW; closes 3000 if previously open
8. Enables + starts services, reloads Caddy, verifies `https://<domain>/api/health` returns 200

### Flags

| Flag | Effect |
| --- | --- |
| `--domain <d>` | Required. FQDN to serve on. |
| `--email <e>` | Required. ACME contact address (Let's Encrypt). |
| `--yes` / `-y` | Skip confirmation prompts. |
| `--dry-run` | Print every step without making changes. |
| `-h` / `--help` | Show usage. |

### After it finishes

```bash
# Confirm everything is up
sudo systemctl status storeai-web storeai-worker caddy
curl -I https://app.example.com/api/health          # 200
curl -s https://app.example.com/api/health?deep=1   # JSON with Postgres/Redis/S3 checks

# Logs
sudo journalctl -u storeai-web -f
sudo journalctl -u caddy -f                         # cert issuance, reloads
```

### Updating an existing deploy

```bash
cd ~/storeai
git pull
# Re-run the deploy — it's idempotent, rebuilds, and restarts services:
pnpm deploy:domain --domain app.example.com --email you@example.com --yes
```

---

## Self-managed reverse proxy

If you already run Nginx/Traefik/whatever and don't want to install Caddy.

1. Put StoreAI behind your proxy on `localhost:3000`
2. In `.env`: set `HOST=localhost`, `APP_URL=https://<your-domain>`, `NODE_ENV=production`
3. `pnpm build && pnpm start` (wrap in your usual process supervisor — pm2, systemd, etc.)
4. Start `pnpm worker:start` as a separate service
5. Make sure your proxy **forwards `X-Forwarded-For`** (the app uses it for rate-limiting) and sets `Host`

Minimal Nginx snippet:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    # ... ssl_certificate, etc.

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 60M;
    }

    # Deny common probe paths (defense in depth on top of the app middleware)
    location ~* /\.(env|git|aws|ssh)(/|$)         { return 404; }
    location ~* /(wp-admin|phpmyadmin|adminer)    { return 404; }
    location ~* /(etc/passwd|proc/self|cgi-bin)   { return 404; }
}
```

---

## Troubleshooting

### "Invalid email or password" right after setup
The credentials are whatever `pnpm bootstrap` printed at the end. If you missed them:
```bash
grep '^SEED_ADMIN_' .env
```
That's the source of truth — the seed rotates the DB to match `.env` on every run.

### I signed up via the UI and forgot the password
```bash
pnpm admin:reset-password --email you@example.com --password 'newpass1234'
```

### Certificate didn't issue
```bash
sudo journalctl -u caddy -n 100
```
Common causes: DNS not pointing at the host, port 80 blocked by the cloud provider (not just UFW), or Let's Encrypt rate-limiting a repeated failure.

### 502 Bad Gateway after successful cert
Node app isn't listening on loopback. Check:
```bash
ss -ltnp | grep :3000
sudo systemctl status storeai-web
sudo journalctl -u storeai-web -n 100
```

### Redis or Postgres went down and the app hangs
It shouldn't — rate-limit + enqueue paths fail open; session + DB-read paths return 503 via `/api/health?deep=1`. If it does hang, file an issue with the output of:
```bash
curl -s http://localhost:3000/api/health?deep=1
```

### Can I update without downtime?
Rolling deploys aren't built in. For a single-box deploy the usual pattern is:
```bash
git pull
pnpm build                              # build the new bundle first
sudo systemctl restart storeai-web      # ~2s downtime
sudo systemctl restart storeai-worker
```
For zero-downtime, run two instances behind a load balancer and rotate.

### Complete reset (nukes data)
```bash
pnpm clean         # removes volumes + .next + caches (keeps .env)
pnpm bootstrap     # fresh infra + migrate + seed
```

---

## Next steps

- Security and ops you should do before real traffic: [`../infrastructure/docs/production-hardening.md`](../infrastructure/docs/production-hardening.md)
- How the pieces fit together: [`../infrastructure/docs/architecture.md`](../infrastructure/docs/architecture.md)
- Day-to-day commands: [`../README.md`](../README.md)
- Contributing: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
