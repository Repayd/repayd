#!/usr/bin/env bash
# One service, one public port.
#
# The dashboard binds the public port and serves the runner routes plus a /v1/*
# passthrough. The coverage API runs beside it on loopback and is reached only
# through that passthrough, so it is never exposed directly.
#
# The dashboard is started first on purpose: platforms that auto-detect a port
# tend to pick the first one that opens.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Workspace packages are linked by the installer. Run it at boot so the runtime
# always has the links, even when a build cache served a stale node_modules.
if [ "${REPAYD_SKIP_INSTALL:-0}" != "1" ]; then
  bun install --frozen-lockfile
fi

export REPAYD_API_URL="${REPAYD_API_URL:-http://127.0.0.1:8787}"
export REPAYD_API_PORT="${REPAYD_API_PORT:-8787}"

bun run --cwd packages/dashboard serve.ts &
dashboard_pid=$!

bun run --cwd packages/api start:api &
api_pid=$!

cleanup() {
  kill "$dashboard_pid" "$api_pid" 2>/dev/null || true
  wait "$dashboard_pid" "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# If either process dies the service should restart, not linger half-broken.
wait -n "$dashboard_pid" "$api_pid"
exit 1
