#!/usr/bin/env bash
#
# Nuclear clean — wipes all StoreAI local state:
#   - Docker containers + named volumes (Postgres, Redis, MinIO data)
#   - Next.js build output (.next)
#   - Node + pnpm caches
#
# After this, run `pnpm bootstrap` to start fresh.
#
set -euo pipefail
cd "$(dirname "$0")/../.."

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m!\033[0m %s\n" "$*"; }

bold "StoreAI clean — $(pwd)"

if [ -f .env ]; then
  docker compose -f infrastructure/docker/docker-compose.yml --env-file .env down -v 2>/dev/null || true
else
  docker compose -f infrastructure/docker/docker-compose.yml down -v 2>/dev/null || true
fi
ok "Infra containers + volumes removed"

# Remove any stragglers that match our naming convention, in case compose
# didn't see them (e.g. .env missing).
for v in docker_storeai_pg docker_storeai_redis docker_storeai_minio storeai_pg storeai_redis storeai_minio; do
  docker volume rm -f "$v" >/dev/null 2>&1 || true
done
ok "Named volumes scrubbed"

rm -rf apps/web/.next
ok "Removed apps/web/.next"

rm -rf node_modules/.cache apps/*/node_modules/.cache packages/*/node_modules/.cache
ok "Removed build caches"

if [ -f .env ]; then
  warn ".env kept (contains your local secrets). Delete it yourself if you want a fully blank slate."
fi

echo
bold "Clean complete."
echo "Next: pnpm bootstrap"
