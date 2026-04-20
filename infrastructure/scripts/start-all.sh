#!/usr/bin/env bash
# Run the Next.js app and the BullMQ worker together, streaming both logs.
set -euo pipefail
cd "$(dirname "$0")/../.."

cleanup() {
  trap - EXIT INT TERM
  if [ -n "${WEB_PID:-}" ]; then kill "$WEB_PID" 2>/dev/null || true; fi
  if [ -n "${WORKER_PID:-}" ]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Prefix each line so logs are distinguishable
pnpm --filter @storeai/web run dev 2>&1 | sed -u 's/^/[web]    /' &
WEB_PID=$!

pnpm --filter @storeai/worker run dev 2>&1 | sed -u 's/^/[worker] /' &
WORKER_PID=$!

wait -n "$WEB_PID" "$WORKER_PID"
