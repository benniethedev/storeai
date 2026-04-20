#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "Tearing down infra (including volumes)..."
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env down -v

echo "Starting infra..."
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env up -d

bash infrastructure/scripts/wait-for-infra.sh

echo "Running migrations..."
pnpm --filter @storeai/db migrate

echo "Seeding..."
pnpm --filter @storeai/db seed

echo "Reset complete."
