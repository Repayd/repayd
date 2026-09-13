#!/bin/bash
# Hub-managed demo runner — ARC TESTNET mode (the real chain).
# Trigger = theater page's RUN DEMO → POST /api/theater/trigger → poke file.
#
# Each cycle:
#   0. kills stray demos + tops up gas for the signing actors (real txs)
#   1. deploys a FRESH contract stack on Arc testnet (real txs, real keys
#      from .env; the previous stack is one-shot-consumed by design)
#   2. runs the full demo against that on-chain stack (real USDC flows,
#      real holds/verdicts/payout — every beat is an Arc transaction)
#   3. bash posts the authoritative done-event to the dashboard theater.
#
# Why the ceremony: a SIGKILLed runner leaves its demo child alive, and two
# demos on one chain send the same payroll twice → nonce collision / double
# daily spend → OVER_DAILY. So every cycle starts by reaping strays.
POKE=/tmp/repayd-demo-trigger
PIDF=/tmp/repayd-demo-runner.pid
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Arc keys + endpoints come from the gitignored .env (testnet-only keys).
set -a
. "$ROOT/.env"
set +a
export DEMO_RPC_URL="${DEMO_RPC_URL:-https://rpc.testnet.arc.io}"
export DEMO_CHAIN_ID="${DEMO_CHAIN_ID:-5042002}"
export REPAYD_THEATER_INGEST=http://localhost:3000/api/theater/ingest

post_done() {
  curl -s -X POST http://localhost:3000/api/theater/done -H 'content-type: application/json' \
    -d "{\"exit\": $1}" >/dev/null 2>&1 || true
}

# Gas bootstrap: the demo's agent key + watcher SIGN transactions on Arc and
# need native-USDC gas. Amara (the funded deployer) tops them up when low —
# these top-ups are real Arc transactions too.
CAST="$HOME/.foundry/bin/cast"
gas_topup() { # gas_topup <actor-private-key>
  local addr bal
  addr=$("$CAST" wallet address --private-key "$1" 2>/dev/null) || return 0
  bal=$("$CAST" balance "$addr" --rpc-url "$DEMO_RPC_URL" 2>/dev/null) || return 0
  if [ -z "$bal" ] || [ "$bal" -lt 50000000000000000 ]; then
    "$CAST" send "$addr" --value 300000000000000000 \
      --private-key "$AMARA_PRIVATE_KEY" --rpc-url "$DEMO_RPC_URL" >/dev/null 2>&1 \
      && echo "runner $$ gas top-up → $addr" >> /tmp/runner-diag.log
  fi
}

# Startup sweep: kill every other runner loop (duplicate loops = nonce races).
for p in $(ps ax -o pid=,command= | grep "run-demo-trigger.sh" | grep -v grep | awk '{print $1}'); do
  [ "$p" != "$$" ] && kill -9 "$p" 2>/dev/null
done
echo "$$" > "$PIDF"

while true; do
  [ -f "$POKE" ] || { sleep 0.5; continue; }
  rm -f "$POKE"

  echo "$$" > "$PIDF"; sleep 0.6
  if [ "$(cat "$PIDF" 2>/dev/null)" != "$$" ]; then
    echo "runner $$ lost cycle claim — standing down" >> /tmp/runner-diag.log
    continue
  fi

  echo "runner $$ ARC cycle start $(date +%T)" >> /tmp/runner-diag.log

  # 0a. reap stray demos (a SIGKILLed runner orphanes its demo child).
  for p in $(ps ax -o pid=,command= | grep "src/demo.ts" | grep -v grep | awk '{print $1}'); do
    kill -9 "$p" 2>/dev/null
  done

  # 0b. gas for the signing actors (idempotent; no-op when already funded).
  gas_topup "$AGENT_KEY_PRIVATE_KEY"
  gas_topup "$WATCHER_PRIVATE_KEY"

  # 1. fresh on-chain deploy (Arc testnet). Remove the stale record first so
  #    a failed deploy can never be mistaken for success.
  mkdir -p "$ROOT/contracts/deployments"
  rm -f "$ROOT/contracts/deployments/5042002.json" "$ROOT/contracts/deployments/31337.json"
  (cd "$ROOT/contracts" && forge script script/Deploy.s.sol --rpc-url "$DEMO_RPC_URL" --broadcast > /tmp/forge-deploy.log 2>&1)
  if [ ! -f "$ROOT/contracts/deployments/5042002.json" ]; then
    echo "runner $$ Arc deploy FAILED — tail:" >> /tmp/runner-diag.log
    tail -3 /tmp/forge-deploy.log >> /tmp/runner-diag.log 2>/dev/null
    post_done 3
    sleep 2
    continue
  fi
  guard=$(jq -r '.contracts.guardAccount' "$ROOT/contracts/deployments/5042002.json")
  echo "runner $$ deployed guard=$guard $(date +%T)" >> /tmp/runner-diag.log

  # 2. the show — every beat is a live Arc transaction.
  (cd "$ROOT" && exec bun run packages/demo/src/demo.ts)
  rc=$?
  echo "runner $$ demo-exit=$rc $(date +%T)" >> /tmp/runner-diag.log
  post_done "$rc"

  rm -f "$POKE"
done
