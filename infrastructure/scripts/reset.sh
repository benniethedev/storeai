#!/usr/bin/env bash
# Wipe volumes, re-bring-up infra, re-migrate, re-seed. .env is preserved.
set -euo pipefail
cd "$(dirname "$0")/../.."

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }

bold "Resetting infra volumes + DB"
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env down -v
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env up -d
bash infrastructure/scripts/wait-for-infra.sh

bold "Applying migrations"
pnpm --filter @storeai/db migrate

bold "Seeding from .env"
pnpm --filter @storeai/db seed

echo
FINAL_EMAIL="$(grep -E '^SEED_ADMIN_EMAIL=' .env | head -1 | sed -E 's/^SEED_ADMIN_EMAIL=//')"
FINAL_PASSWORD="$(grep -E '^SEED_ADMIN_PASSWORD=' .env | head -1 | sed -E 's/^SEED_ADMIN_PASSWORD=//')"
bold "Reset complete. Sign in with:"
printf "  Email:    %s\n" "$FINAL_EMAIL"
printf "  Password: %s\n" "$FINAL_PASSWORD"
