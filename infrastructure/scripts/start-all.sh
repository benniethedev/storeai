#!/usr/bin/env bash
#
# Run the production web + worker together on a single box, with prefixed
# logs. Uses `pnpm start` / `pnpm worker:start` — production paths only.
#
# This is the default for `pnpm start:all`. It is NOT the blessed
# production path — use `pnpm deploy:domain` + systemd for that. But this
# script never runs a development server, so it's safe to point ops
# runbooks at.
#
# Binds to 127.0.0.1 by default (via the web package's HOST default).
# Override with HOST=0.0.0.0 if you know what you're doing.
#
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -d apps/web/.next ]; then
  echo "No production build found at apps/web/.next/." >&2
  echo "Run 'pnpm build' first." >&2
  exit 1
fi

cleanup() {
  trap - EXIT INT TERM
  if [ -n "${WEB_PID:-}" ]; then kill "$WEB_PID" 2>/dev/null || true; fi
  if [ -n "${WORKER_PID:-}" ]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

NODE_ENV="${NODE_ENV:-production}" \
  pnpm --filter @storeai/web run start 2>&1 | sed -u 's/^/[web]    /' &
WEB_PID=$!

NODE_ENV="${NODE_ENV:-production}" \
  pnpm --filter @storeai/worker run start 2>&1 | sed -u 's/^/[worker] /' &
WORKER_PID=$!

wait -n "$WEB_PID" "$WORKER_PID"
