#!/usr/bin/env bash
# One service, one public port.
#
# The dashboard binds $PORT (the only port the platform routes to) and serves the
# runner routes plus a /v1/* passthrough. The coverage API runs beside it on
# loopback and is reached only through that passthrough, so it is never exposed
# directly.
#
# Safe to invoke from any working directory: the platform may start this via
# `bun run --cwd packages/api start`, which would otherwise leave the shell in
# packages/api.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

export REPAYD_API_URL="${REPAYD_API_URL:-http://127.0.0.1:8787}"
export REPAYD_API_PORT="${REPAYD_API_PORT:-8787}"

bun run --cwd packages/api start:api &
api_pid=$!

bun run --cwd packages/dashboard serve.ts &
dashboard_pid=$!

cleanup() {
  kill "$api_pid" "$dashboard_pid" 2>/dev/null || true
  wait "$api_pid" "$dashboard_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# If either process dies the service should restart, not linger half-broken.
wait -n "$api_pid" "$dashboard_pid"
exit 1
