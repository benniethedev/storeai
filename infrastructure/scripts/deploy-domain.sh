#!/usr/bin/env bash
#
# StoreAI: attach a domain + Let's Encrypt HTTPS to an existing install.
#
# What it does (Ubuntu/Debian host, repo already bootstrapped):
#   1. Preflights: OS, sudo, pnpm, .env, port 80/443 free, DNS points here
#   2. Installs Caddy from the official apt repo (if missing)
#   3. Writes /etc/caddy/Caddyfile from infrastructure/caddy/Caddyfile.example
#   4. Updates .env: HOST=localhost, APP_URL=https://<domain>
#   5. Runs `pnpm build` (production bundle)
#   6. Writes two systemd units (storeai-web, storeai-worker)
#   7. Opens 80/443 in UFW if UFW is active; closes 3000 if previously open
#   8. Enables + starts the services and reloads Caddy
#   9. Verifies https://<domain>/api/health returns 200
#
# Usage:
#   bash infrastructure/scripts/deploy-domain.sh \
#        --domain app.example.com \
#        --email  you@example.com
#
# Flags:
#   --domain <d>   Fully qualified domain (required)
#   --email  <e>   ACME contact email (required; used by Let's Encrypt)
#   --yes | -y     Skip confirmation prompts
#   --dry-run      Print what would happen; make no changes
#   -h | --help    Show this header
#
# Idempotent — safe to re-run after DNS changes or repo updates.
#
set -euo pipefail

# ---------- helpers ----------
bold()    { printf "\033[1m%s\033[0m\n" "$*"; }
dim()     { printf "\033[2m%s\033[0m\n" "$*"; }
ok()      { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn()    { printf "\033[33m!\033[0m %s\n" "$*"; }
fail()    { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
step()    { echo; bold "→ $*"; }
die()     { fail "$1"; exit 1; }

have()    { command -v "$1" >/dev/null 2>&1; }

run() {
  if [ "${DRY_RUN:-false}" = "true" ]; then
    printf "  \033[2m[dry-run]\033[0m %s\n" "$*"
  else
    eval "$@"
  fi
}

# ---------- args ----------
DOMAIN=""
ACME_EMAIL=""
ASSUME_YES="false"
DRY_RUN="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   DOMAIN="$2"; shift 2 ;;
    --email)    ACME_EMAIL="$2"; shift 2 ;;
    --yes|-y)   ASSUME_YES="true"; shift ;;
    --dry-run)  DRY_RUN="true"; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *)          die "Unknown arg: $1 (try --help)" ;;
  esac
done

cd "$(dirname "$0")/../.."
REPO_DIR="$(pwd)"
bold "StoreAI domain deploy — $REPO_DIR"
[ "$DRY_RUN" = "true" ] && dim "(dry-run mode — no changes will be made)"

# ---------- interactive prompts for missing args ----------
if [ -z "$DOMAIN" ]; then
  if [ ! -t 0 ]; then die "--domain is required when running non-interactively"; fi
  printf "Domain (e.g. app.example.com): "
  read -r DOMAIN
fi
if [ -z "$ACME_EMAIL" ]; then
  if [ ! -t 0 ]; then die "--email is required when running non-interactively"; fi
  printf "ACME contact email: "
  read -r ACME_EMAIL
fi

# Trivial validation
case "$DOMAIN" in
  *" "*|"")  die "Invalid domain: '$DOMAIN'" ;;
  *.*)       : ;;
  *)         die "Domain must contain a dot (got '$DOMAIN')" ;;
esac
case "$ACME_EMAIL" in
  *@*.*)  : ;;
  *)      die "Invalid email: '$ACME_EMAIL'" ;;
esac

# ---------- OS / tooling preflight ----------
step "Preflight"

if [ "$(uname -s)" != "Linux" ]; then
  die "This script targets Linux (Ubuntu/Debian). Use a reverse proxy of your choice elsewhere."
fi
if [ ! -f /etc/os-release ]; then
  die "Missing /etc/os-release; unsupported distribution."
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in
  ubuntu:*|debian:*|*:debian|*:ubuntu|*:*ubuntu*|*:*debian*) : ;;
  *)
    warn "Detected $PRETTY_NAME — the apt install paths may not apply; proceed with care."
    ;;
esac
ok "Host: $PRETTY_NAME"

if ! sudo -n true 2>/dev/null; then
  warn "sudo will prompt for your password during this run."
fi

for cmd in pnpm node dig curl awk sed; do
  have "$cmd" || die "$cmd not found on PATH. Run pnpm bootstrap first."
done
ok "Tooling OK"

PNPM_BIN="$(command -v pnpm)"
NODE_DIR="$(dirname "$(command -v node)")"
PNPM_DIR="$(dirname "$PNPM_BIN")"
SERVICE_USER="${SUDO_USER:-$USER}"
SERVICE_PATH="$PNPM_DIR:$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
STOREAI_PORT="${PORT:-3000}"
ok "Service user: $SERVICE_USER"
ok "pnpm: $PNPM_BIN"
ok "node PATH segment: $NODE_DIR"

if [ ! -f .env ]; then
  die ".env not found in repo root. Run pnpm bootstrap first."
fi
ok ".env present"

# ---------- DNS check ----------
step "DNS check"
PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || curl -fsS https://ifconfig.me 2>/dev/null || true)"
RESOLVED_IP="$(dig +short "$DOMAIN" A | tail -n1 || true)"
if [ -z "$RESOLVED_IP" ]; then
  warn "Could not resolve $DOMAIN yet — DNS may be propagating. Continuing."
elif [ -n "$PUBLIC_IP" ] && [ "$RESOLVED_IP" != "$PUBLIC_IP" ]; then
  warn "DNS: $DOMAIN → $RESOLVED_IP but this host's public IP is $PUBLIC_IP. Cert issuance will fail until this matches."
  if [ "$ASSUME_YES" != "true" ]; then
    printf "Continue anyway? [y/N] "
    read -r ans
    case "$ans" in y|Y|yes|YES) : ;; *) die "Aborted" ;; esac
  fi
else
  ok "DNS: $DOMAIN → $RESOLVED_IP (matches public IP)"
fi

# ---------- port 80/443 availability ----------
step "Port check"
check_port_free() {
  local port="$1"
  if ss -ltn "sport = :$port" 2>/dev/null | awk 'NR>1' | grep -q .; then
    local holder
    holder="$(ss -ltnp "sport = :$port" 2>/dev/null | awk 'NR==2{print $0}')"
    # If Caddy itself is holding it, that's fine — we'll reconfigure below.
    if echo "$holder" | grep -q "caddy"; then
      ok "Port $port: already held by Caddy (will reconfigure)"
    else
      die "Port $port is held by something other than Caddy. Free it first: $holder"
    fi
  else
    ok "Port $port: free"
  fi
}
check_port_free 80
check_port_free 443

# ---------- plan confirmation ----------
step "Plan"
cat <<EOF
  Domain:          $DOMAIN
  ACME email:      $ACME_EMAIL
  App port (loop): $STOREAI_PORT
  Service user:    $SERVICE_USER
  Repo:            $REPO_DIR
  Caddyfile:       /etc/caddy/Caddyfile
  Systemd units:   /etc/systemd/system/storeai-web.service
                   /etc/systemd/system/storeai-worker.service
EOF
if [ "$ASSUME_YES" != "true" ] && [ "$DRY_RUN" != "true" ]; then
  printf "Proceed? [y/N] "
  read -r ans
  case "$ans" in y|Y|yes|YES) : ;; *) die "Aborted" ;; esac
fi

# ---------- install Caddy ----------
step "Installing Caddy (if not present)"
if have caddy; then
  ok "Caddy already installed ($(caddy version | head -1))"
else
  run "sudo apt-get update -qq"
  run "sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg"
  run "curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
  run "curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null"
  run "sudo apt-get update -qq"
  run "sudo apt-get install -y caddy"
  ok "Caddy installed"
fi

# ---------- render Caddyfile ----------
step "Writing /etc/caddy/Caddyfile"
CADDYFILE_SRC="$REPO_DIR/infrastructure/caddy/Caddyfile.example"
[ -f "$CADDYFILE_SRC" ] || die "Template missing: $CADDYFILE_SRC"

CADDYFILE_RENDERED="$(
  DOMAIN="$DOMAIN" \
  ACME_EMAIL="$ACME_EMAIL" \
  STOREAI_PORT="$STOREAI_PORT" \
  awk '
    {
      gsub(/\{\$DOMAIN\}/, ENVIRON["DOMAIN"])
      gsub(/\{\$ACME_EMAIL\}/, ENVIRON["ACME_EMAIL"])
      gsub(/\{\$STOREAI_PORT\}/, ENVIRON["STOREAI_PORT"])
      print
    }
  ' "$CADDYFILE_SRC"
)"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [dry-run] would write /etc/caddy/Caddyfile:"
  echo "$CADDYFILE_RENDERED" | sed 's/^/    /'
else
  if [ -f /etc/caddy/Caddyfile ] && ! grep -q "^$DOMAIN\b\|^{\$DOMAIN}\b" /etc/caddy/Caddyfile; then
    ts="$(date +%Y%m%d%H%M%S)"
    sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$ts"
    ok "Backed up existing Caddyfile to /etc/caddy/Caddyfile.bak.$ts"
  fi
  printf '%s\n' "$CADDYFILE_RENDERED" | sudo tee /etc/caddy/Caddyfile >/dev/null
  sudo mkdir -p /var/log/caddy
  sudo chown caddy:caddy /var/log/caddy 2>/dev/null || true
  ok "Caddyfile written"
fi

# ---------- update .env ----------
step "Updating .env"
set_env_var() {
  local key="$1" value="$2" file=".env"
  if [ "$DRY_RUN" = "true" ]; then
    echo "  [dry-run] would set $key=$value in $file"
    return
  fi
  local tmp; tmp="$(mktemp)"
  if grep -qE "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN{pat="^" k "="} $0 ~ pat {print k "=" v; next} {print}' "$file" > "$tmp"
  else
    cp "$file" "$tmp"; printf "%s=%s\n" "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}
set_env_var HOST    "localhost"
set_env_var APP_URL "https://$DOMAIN"
set_env_var NODE_ENV "production"
ok "HOST=localhost, APP_URL=https://$DOMAIN, NODE_ENV=production"

# ---------- production build ----------
step "Building production bundle (pnpm build)"
if [ "$DRY_RUN" = "true" ]; then
  echo "  [dry-run] would run: pnpm --filter @storeai/web build"
else
  pnpm --filter @storeai/web build
  ok "Build complete"
fi

# ---------- systemd units ----------
step "Installing systemd units"
render_unit() {
  local src="$1"
  SERVICE_USER="$SERVICE_USER" REPO_DIR="$REPO_DIR" \
  SERVICE_PATH="$SERVICE_PATH" PNPM_BIN="$PNPM_BIN" STOREAI_PORT="$STOREAI_PORT" \
  awk '
    {
      gsub(/\{\$SERVICE_USER\}/, ENVIRON["SERVICE_USER"])
      gsub(/\{\$REPO_DIR\}/, ENVIRON["REPO_DIR"])
      gsub(/\{\$SERVICE_PATH\}/, ENVIRON["SERVICE_PATH"])
      gsub(/\{\$PNPM_BIN\}/, ENVIRON["PNPM_BIN"])
      gsub(/\{\$STOREAI_PORT\}/, ENVIRON["STOREAI_PORT"])
      print
    }
  ' "$src"
}

write_unit() {
  local src="$1" dest="$2"
  local rendered; rendered="$(render_unit "$src")"
  if [ "$DRY_RUN" = "true" ]; then
    echo "  [dry-run] would write $dest:"
    echo "$rendered" | sed 's/^/    /'
  else
    printf '%s\n' "$rendered" | sudo tee "$dest" >/dev/null
    ok "Wrote $dest"
  fi
}
write_unit "$REPO_DIR/infrastructure/systemd/storeai-web.service.example"    /etc/systemd/system/storeai-web.service
write_unit "$REPO_DIR/infrastructure/systemd/storeai-worker.service.example" /etc/systemd/system/storeai-worker.service

run "sudo systemctl daemon-reload"

# ---------- firewall ----------
step "Firewall"
if have ufw && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  run "sudo ufw allow 80/tcp  comment 'StoreAI HTTP (Caddy)'"
  run "sudo ufw allow 443/tcp comment 'StoreAI HTTPS (Caddy)'"
  # Best-effort: if 3000 was opened for direct access before, drop it.
  if sudo ufw status | grep -q "^3000/tcp"; then
    run "sudo ufw delete allow 3000/tcp"
    ok "Closed public access to :3000 (now loopback-only)"
  fi
  ok "UFW: 80/443 open"
else
  warn "UFW not active — skipping firewall changes. Don't forget your cloud provider's firewall!"
fi

# ---------- start services ----------
step "Enabling and starting services"
run "sudo systemctl enable storeai-web.service storeai-worker.service"
run "sudo systemctl restart storeai-web.service storeai-worker.service"
run "sudo systemctl restart caddy"

# ---------- verify ----------
step "Verifying"
if [ "$DRY_RUN" = "true" ]; then
  dim "  [dry-run] would curl https://$DOMAIN/api/health"
else
  sleep 3
  HEALTH_URL="https://$DOMAIN/api/health"
  for i in 1 2 3 4 5 6; do
    if curl -fsS -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null | grep -q "^200$"; then
      ok "$HEALTH_URL → 200"
      break
    fi
    if [ "$i" -eq 6 ]; then
      warn "Could not reach $HEALTH_URL — this is often a DNS / ACME / firewall issue."
      warn "Diagnose with: sudo journalctl -u caddy -n 50; sudo systemctl status storeai-web"
    else
      dim "  not ready yet (attempt $i/6) — sleeping 5s"
      sleep 5
    fi
  done
fi

echo
bold "Done."
cat <<EOF

  App URL        :  https://$DOMAIN
  Caddy          :  sudo systemctl status caddy
  Web service    :  sudo systemctl status storeai-web
  Worker service :  sudo systemctl status storeai-worker
  Caddy logs     :  sudo journalctl -u caddy -f
  Web logs       :  sudo journalctl -u storeai-web -f

  Next steps:
    • Sign in with your seeded admin credentials at https://$DOMAIN
    • Re-run this script any time you change domain/email — it's idempotent
    • Production hardening checklist: infrastructure/docs/production-hardening.md
EOF
