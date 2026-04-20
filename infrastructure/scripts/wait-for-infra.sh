#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# Parse selected values from .env without sourcing (handles spaces)
env_val() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | head -1 | sed -E "s/^${key}=//; s/^[\"']//; s/[\"']$//"
}

PG_HOST="${POSTGRES_HOST:-$(env_val POSTGRES_HOST)}"
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${POSTGRES_PORT:-$(env_val POSTGRES_PORT)}"
PG_PORT="${PG_PORT:-5434}"
REDIS_URL_V="${REDIS_URL:-$(env_val REDIS_URL)}"
REDIS_URL_V="${REDIS_URL_V:-redis://localhost:6381}"
S3_EP="${S3_ENDPOINT:-$(env_val S3_ENDPOINT)}"
S3_EP="${S3_EP:-http://localhost:9002}"

echo "Waiting for Postgres on ${PG_HOST}:${PG_PORT}..."
for i in {1..60}; do
  if (echo > /dev/tcp/${PG_HOST}/${PG_PORT}) >/dev/null 2>&1; then
    echo "  postgres OK"; break
  fi
  sleep 1
  if [ $i -eq 60 ]; then echo "postgres timeout"; exit 1; fi
done

REDIS_HOST=$(echo "$REDIS_URL_V" | sed -E 's|redis://([^:/]+):.*|\1|')
REDIS_PORT=$(echo "$REDIS_URL_V" | sed -E 's|.*:([0-9]+).*|\1|')
echo "Waiting for Redis on ${REDIS_HOST}:${REDIS_PORT}..."
for i in {1..60}; do
  if (echo > /dev/tcp/${REDIS_HOST}/${REDIS_PORT}) >/dev/null 2>&1; then
    echo "  redis OK"; break
  fi
  sleep 1
  if [ $i -eq 60 ]; then echo "redis timeout"; exit 1; fi
done

echo "Waiting for MinIO at ${S3_EP}/minio/health/ready..."
for i in {1..60}; do
  if curl -fsS "${S3_EP}/minio/health/ready" >/dev/null 2>&1; then
    echo "  minio OK"; break
  fi
  sleep 1
  if [ $i -eq 60 ]; then echo "minio timeout"; exit 1; fi
done

echo "Infrastructure ready."
