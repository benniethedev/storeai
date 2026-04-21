#!/usr/bin/env bash
#
# StoreAI one-command setup.
# Usage:
#   bash infrastructure/scripts/bootstrap.sh              # interactive (prompts for admin creds)
#   bash infrastructure/scripts/bootstrap.sh --yes        # non-interactive (auto-generates password)
#
# Idempotent: safe to re-run. If .env already exists it is left alone.
#
set -euo pipefail

# ---------- helpers ----------
bold() { printf "\033[1m%s\033[0m\n" "$*"; }
dim()  { printf "\033[2m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m!\033[0m %s\n" "$*"; }
fail() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
step() { echo; bold "→ $*"; }

require_cmd() {
  local cmd="$1" install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "$cmd not found. $install_hint"
    exit 1
  fi
}

ver_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

random_hex() {
  node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"
}

random_b64url() {
  node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"
}

# Replace or append KEY=VALUE in .env, preserving other lines.
set_env_var() {
  local key="$1" value="$2" file=".env"
  local tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" '
      BEGIN { pat = "^" k "=" }
      $0 ~ pat { print k "=" v; next }
      { print }
    ' "$file" > "$tmp"
  else
    cp "$file" "$tmp"
    printf "%s=%s\n" "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}

# ---------- args ----------
NON_INTERACTIVE="false"
for arg in "$@"; do
  case "$arg" in
    --yes|-y|--non-interactive) NON_INTERACTIVE="true" ;;
    --help|-h)
      sed -n '2,10p' "$0"
      exit 0
      ;;
  esac
done

# If stdin isn't a tty (e.g. piped), force non-interactive.
if [ ! -t 0 ]; then NON_INTERACTIVE="true"; fi

# ---------- preflight ----------
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
bold "StoreAI bootstrap — $ROOT"

step "Checking prerequisites"

require_cmd node    "Install Node.js 20+: https://nodejs.org (or use fnm/nvm)."
NODE_VER="$(node -v | sed 's/^v//')"
if ! ver_ge "$NODE_VER" "20.0.0"; then
  fail "Node.js 20+ required, found $NODE_VER."
  exit 1
fi
ok "Node.js $NODE_VER"

require_cmd pnpm    "Install pnpm: npm i -g pnpm (or: corepack enable && corepack prepare pnpm@latest --activate)."
ok "pnpm $(pnpm -v)"

require_cmd docker  "Install Docker (Desktop on macOS; docker-ce + docker-compose-plugin on Ubuntu)."
if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but the daemon isn't running. Start Docker Desktop or the docker service and re-run."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose v2 plugin missing. Install 'docker-compose-plugin'."
  exit 1
fi
ok "Docker + Compose v2"

require_cmd curl    "Install curl."

# ---------- .env ----------
step "Preparing .env"

FRESH_ENV="false"
if [ ! -f .env ]; then
  cp .env.example .env
  FRESH_ENV="true"
  ok "Created .env from .env.example"
else
  ok ".env already exists — keeping your values"
fi

# Force a real AUTH_SECRET if the current value is missing, short, or a known
# placeholder. We check for multiple known placeholder prefixes and a minimum
# length of 40 chars (a reasonable floor; real values are 48+ bytes).
CURRENT_SECRET="$(grep -E '^AUTH_SECRET=' .env | head -1 | sed 's/^AUTH_SECRET=//' || true)"
REGEN_SECRET="false"
if [ -z "$CURRENT_SECRET" ]; then REGEN_SECRET="true"; fi
case "$CURRENT_SECRET" in
  dev_auth_secret_change_me*|REPLACE_ME*|CHANGE_ME*|change-me*|changeme) REGEN_SECRET="true" ;;
esac
if [ "${#CURRENT_SECRET}" -lt 40 ]; then REGEN_SECRET="true"; fi

if [ "$REGEN_SECRET" = "true" ]; then
  SECRET="$(random_b64url 48)"
  set_env_var AUTH_SECRET "$SECRET"
  ok "Generated a random AUTH_SECRET"
else
  ok "AUTH_SECRET already customized"
fi

# ---------- admin credentials ----------
# Runs on every bootstrap. If .env already has real values we preserve them;
# only prompt (or auto-generate in --yes mode) if the password is missing,
# a known-weak placeholder, or too short. The seed step below will rotate the
# DB password to match .env, so the creds we print at the end are always the
# real ones.
step "Admin account"

DEFAULT_EMAIL="admin@storeai.local"
DEFAULT_TENANT_NAME="My Workspace"
DEFAULT_TENANT_SLUG="workspace"
GENERATED_PASSWORD=""

current_env_var() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | head -1 | sed -E "s/^${key}=//" || true
}

PASSWORD_CURRENT="$(current_env_var SEED_ADMIN_PASSWORD)"
EMAIL_CURRENT="$(current_env_var SEED_ADMIN_EMAIL)"

password_needs_setup() {
  case "$1" in
    ""|"CHANGE_ME_BEFORE_SEEDING"|"admin12345"|"admin"|"password"|"changeme"|"change-me")
      return 0 ;;
  esac
  [ "${#1}" -lt 8 ]
}

if password_needs_setup "$PASSWORD_CURRENT"; then
  dim "Admin password in .env is missing or a known placeholder — setting it now."
  if [ "$NON_INTERACTIVE" = "true" ]; then
    ADMIN_EMAIL="${EMAIL_CURRENT:-$DEFAULT_EMAIL}"
    ADMIN_PASSWORD="$(random_hex 12)"
    TENANT_NAME="$(current_env_var SEED_TENANT_NAME)"
    TENANT_NAME="${TENANT_NAME:-$DEFAULT_TENANT_NAME}"
    TENANT_SLUG="$(current_env_var SEED_TENANT_SLUG)"
    TENANT_SLUG="${TENANT_SLUG:-$DEFAULT_TENANT_SLUG}"
    GENERATED_PASSWORD="$ADMIN_PASSWORD"
    warn "Non-interactive: generated a random admin password. It is printed at the end — save it."
  else
    printf "Admin email [%s]: " "${EMAIL_CURRENT:-$DEFAULT_EMAIL}"
    read -r ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-${EMAIL_CURRENT:-$DEFAULT_EMAIL}}"

    while :; do
      printf "Admin password (8+ chars, leave blank to auto-generate): "
      stty -echo 2>/dev/null || true
      read -r ADMIN_PASSWORD
      stty echo 2>/dev/null || true
      echo
      if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD="$(random_hex 12)"
        GENERATED_PASSWORD="$ADMIN_PASSWORD"
        break
      fi
      if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
        warn "Password must be at least 8 characters."
        continue
      fi
      printf "Confirm password: "
      stty -echo 2>/dev/null || true
      read -r ADMIN_PASSWORD_CONFIRM
      stty echo 2>/dev/null || true
      echo
      if [ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]; then
        warn "Passwords don't match. Try again."
        continue
      fi
      break
    done

    TENANT_NAME_PRIOR="$(current_env_var SEED_TENANT_NAME)"
    TENANT_SLUG_PRIOR="$(current_env_var SEED_TENANT_SLUG)"
    printf "Workspace name [%s]: " "${TENANT_NAME_PRIOR:-$DEFAULT_TENANT_NAME}"
    read -r TENANT_NAME
    TENANT_NAME="${TENANT_NAME:-${TENANT_NAME_PRIOR:-$DEFAULT_TENANT_NAME}}"

    printf "Workspace slug [%s]: " "${TENANT_SLUG_PRIOR:-$DEFAULT_TENANT_SLUG}"
    read -r TENANT_SLUG
    TENANT_SLUG="${TENANT_SLUG:-${TENANT_SLUG_PRIOR:-$DEFAULT_TENANT_SLUG}}"
  fi

  set_env_var SEED_ADMIN_EMAIL    "$ADMIN_EMAIL"
  set_env_var SEED_ADMIN_PASSWORD "$ADMIN_PASSWORD"
  set_env_var SEED_TENANT_NAME    "$TENANT_NAME"
  set_env_var SEED_TENANT_SLUG    "$TENANT_SLUG"
  ok "Admin configured: $ADMIN_EMAIL (workspace: $TENANT_SLUG)"
else
  ok "Admin credentials in .env look good — reusing them"
fi

# ---------- install ----------
step "Installing dependencies (pnpm install)"
pnpm install --prefer-offline
ok "Dependencies installed"

# ---------- infra ----------
step "Starting infrastructure (Postgres, Redis, MinIO)"
pnpm infra:up
bash infrastructure/scripts/wait-for-infra.sh
ok "Infra ready"

# ---------- migrate + seed ----------
step "Applying migrations"
pnpm db:migrate
ok "Migrations applied"

step "Seeding admin + workspace"
pnpm db:seed
ok "Seed complete"

# ---------- done ----------
echo
bold "All set."
cat <<EOF

  Start the app      :  pnpm dev            → http://localhost:3000
  Start the worker   :  pnpm worker
  Or run both        :  pnpm start:all

  MinIO console      :  http://localhost:9003
  Stop infra         :  pnpm infra:down
  Reset everything   :  pnpm reset
EOF

# Always print the live credentials by reading them back from .env, so what
# the user sees on screen is guaranteed to match what seed wrote into the DB.
FINAL_EMAIL="$(grep -E '^SEED_ADMIN_EMAIL=' .env | head -1 | sed -E 's/^SEED_ADMIN_EMAIL=//')"
FINAL_PASSWORD="$(grep -E '^SEED_ADMIN_PASSWORD=' .env | head -1 | sed -E 's/^SEED_ADMIN_PASSWORD=//')"

echo
bold "Your sign-in:"
printf "  Email:    %s\n" "$FINAL_EMAIL"
if [ -n "$GENERATED_PASSWORD" ]; then
  printf "  Password: %s  \033[33m(auto-generated — save it now)\033[0m\n" "$FINAL_PASSWORD"
else
  printf "  Password: %s\n" "$FINAL_PASSWORD"
fi

echo
dim "Credentials are stored as SEED_ADMIN_* in .env — change them and re-run 'pnpm bootstrap' (or 'pnpm db:seed') any time."
echo
