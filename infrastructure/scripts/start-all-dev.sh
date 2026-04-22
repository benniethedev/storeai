#!/usr/bin/env bash
#
# Local development: run the Next.js dev server + worker with live reload.
# Refuses to run with NODE_ENV=production. Never use this on a VPS.
#
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "start-all-dev.sh runs 'next dev' (development-only)." >&2
  echo "Refusing because NODE_ENV=production is set." >&2
  echo "For production: 'pnpm build && pnpm start:all' or 'pnpm deploy:domain'." >&2
  exit 1
fi

cleanup() {
  trap - EXIT INT TERM
  if [ -n "${WEB_PID:-}" ]; then kill "$WEB_PID" 2>/dev/null || true; fi
  if [ -n "${WORKER_PID:-}" ]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

pnpm --filter @storeai/web run dev 2>&1 | sed -u 's/^/[web]    /' &
WEB_PID=$!

pnpm --filter @storeai/worker run dev 2>&1 | sed -u 's/^/[worker] /' &
WORKER_PID=$!

wait -n "$WEB_PID" "$WORKER_PID"
