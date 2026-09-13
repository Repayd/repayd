#!/bin/bash
# REPAYD — one-shot demo launcher: fresh chain → deploy → services → theater run.
# Usage:  bash run-demo.sh
set -e
cd "$(dirname "$0")"

export DEMO_RPC_URL=http://localhost:8545
export DEMO_CHAIN_ID=31337
export AMARA_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export NUNO_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export WATCHER_PRIVATE_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
export AGENT_KEY_PRIVATE_KEY=0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e
export REPAYD_THEATER_INGEST=http://localhost:3000/api/theater/ingest
BUN_BIN="$(command -v bun)"

echo "── [1/5] fresh anvil ──────────────────────────────────────────"
lsof -tiTCP:8545 -sTCP:LISTEN | xargs kill 2>/dev/null || true
sleep 1
nohup anvil --port 8545 --silent > /tmp/anvil-repayd.log 2>&1 < /dev/null &
for i in $(seq 1 20); do
  curl -s -X POST "$DEMO_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | grep -q result && break
  sleep 0.5
done
echo "   anvil up on :8545"

echo "── [2/5] deploy contracts ─────────────────────────────────────"
mkdir -p contracts/deployments
rm -f contracts/deployments/31337.json contracts/deployments/5042002.json
(cd contracts && "$BUN_BIN" --version >/dev/null 2>&1 || true
  AMARA_PRIVATE_KEY="$AMARA_PRIVATE_KEY" forge script script/Deploy.s.sol \
    --rpc-url "$DEMO_RPC_URL" --broadcast 2>&1 | grep -E "ONCHAIN|Error" | head -2)
jq '.chainId = 5042002 | .chainIdAnchor = "0x0000000000000000000000000000000004CDF2"' \
  contracts/deployments/31337.json > contracts/deployments/5042002.json
echo "   stack deployed + Arc alias written"

echo "── [3/5] services (api :8787 · dashboard :3000 · x402 :4601) ──"
for svc in "packages/api|src/server.ts|api" "packages/dashboard|serve.ts|dashboard"; do
  dir="${svc%%|*}"; rest="${svc#*|}"; script="${rest%%|*}"; name="${rest##*|}"
  lsof -tiTCP:$( [ "$name" = api ] && echo 8787 || echo 3000 ) -sTCP:LISTEN | xargs kill 2>/dev/null || true
  (cd "$dir" && ARC_RPC_URL="$DEMO_RPC_URL" REPAYD_X402_PORT=4601 HEDERA_SERVICE_ID=0.0.10484593 \
     nohup "$BUN_BIN" run "$script" > "/tmp/repayd-$name.log" 2>&1 < /dev/null &)
done
(cd packages/hedera && REPAYD_X402_PORT=4601 HEDERA_SERVICE_ID=0.0.10484593 \
   HEDERA_NETWORK=testnet nohup "$BUN_BIN" run src/server.ts > /tmp/repayd-x402.log 2>&1 < /dev/null &)
sleep 2
curl -s localhost:8787/v1/atlas/overview | head -c 80; echo " ← api live"
curl -s localhost:3000/api/health; echo " ← dashboard live"

echo "── [4/5] opening theater ──────────────────────────────────────"
open http://localhost:3000/theater
sleep 2

echo "── [5/5] RUN THE SHOW ─────────────────────────────────────────"
(cd packages/demo && "$BUN_BIN" run src/demo.ts)
echo
echo "✓ demo complete — watch the theater page for the full story replay"
