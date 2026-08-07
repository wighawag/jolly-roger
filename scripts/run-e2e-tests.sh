#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# The deploy account must be funded on the node. The `local` network derives its
# (pre-funded) accounts from MNEMONIC, while the deploy signs with
# MNEMONIC_localhost, so a developer who sets only one of them in
# contracts/.env.local ends up funding one set of accounts and deploying from
# another - the run then dies with "Sender doesn't have enough funds". Pin BOTH
# here: exported shell env outranks every .env file in ldenv, which also keeps
# the run identical on every machine.
TEST_MNEMONIC="test test test test test test test test test test test junk"
export MNEMONIC="$TEST_MNEMONIC"
export MNEMONIC_localhost="$TEST_MNEMONIC"

# Ports are overridable so a run can step aside from anything else already on
# the machine, rather than killing it. E2E_RPC_PORT moves the chain, E2E_PORT
# moves the web server (read by playwright.config.ts and e2e/fixtures/test.ts).
RPC_PORT="${E2E_RPC_PORT:-8545}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
export E2E_RPC_PORT="$RPC_PORT"
export E2E_RPC_URL="$RPC_URL"

# Point the deploy/export at that chain, and build the app against it. Exported
# shell env outranks every .env file in ldenv, so this beats the 8545 baked into
# .env.localhost without editing it.
export ETH_NODE_URI_localhost="$RPC_URL"
export PUBLIC_NODE_URL="$RPC_URL"
# Also the WALLET-facing url, which .env.localhost pins to 127.0.0.1:8545.
# Overriding PUBLIC_NODE_URL alone is not enough: this one is handed to the
# wallet as the chain's RPC, so leaving it at 8545 points part of the stack at
# whatever happens to be on that port - another project's chain, or nothing.
# Either way the run is not isolated, which is the whole purpose of
# E2E_RPC_PORT. Symptom when it goes wrong: reads return "0x" for contracts
# that were definitely just deployed.
export PUBLIC_CHAIN_INFO_NODE_URL="$RPC_URL"


# Track the node for cleanup.
#
# NODE_PGID, not just NODE_PID: `pnpm run node:local` is a wrapper, and the real
# hardhat process is its child (in other repos the chain is longer still, e.g.
# `sh -c` -> `ldenv` -> `hardhat`). Killing the wrapper alone leaves the actual
# node orphaned - it keeps the port bound, and keeps the script's stdout open,
# so anything reading that output hangs long after the tests have finished. In
# CI that burns the job timeout instead of reporting the result.
NODE_PID=""
NODE_PGID=""
NODE_LOG="${TMPDIR:-/tmp}/jolly-roger-e2e-node.log"

# Cleanup function to kill background processes
#
# Only ever stops what THIS run started. Port 8545 (and 4173) may belong to a
# node or server the developer is using for something else, and blanket
# `lsof -ti:<port> | xargs kill -9` / `pkill -f hardhat` would take those down
# too - including another project's chain, mid-session.
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"

    # Kill the Hardhat node if we started it - the whole process group, so no
    # wrapper's child outlives the run. `setsid` below put it in its own group,
    # so this cannot reach anything we did not start.
    if [ -n "$NODE_PGID" ]; then
        echo "Stopping the Hardhat node this run started (PGID: $NODE_PGID)..."
        kill -- "-$NODE_PGID" 2>/dev/null || true
        sleep 1
        kill -9 -- "-$NODE_PGID" 2>/dev/null || true
    elif [ -n "$NODE_PID" ]; then
        # Fell back to a bare PID (process group could not be resolved).
        echo "Stopping the Hardhat node this run started (PID: $NODE_PID)..."
        kill "$NODE_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$NODE_PID" 2>/dev/null || true
    fi

    # The preview server is started and stopped by Playwright's `webServer`, so
    # it is not ours to kill.

    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Set up trap to ensure cleanup runs on exit (success or failure)
trap cleanup EXIT

echo -e "${GREEN}🚀 Starting E2E test setup...${NC}\n"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
WEB_DIR="$ROOT_DIR/web"

# Nothing is pre-killed: whatever is on these ports may not be ours (see
# cleanup above). An already-running node is reused instead.

node_is_up() {
    curl -s -X POST "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        >/dev/null 2>&1
}

# Check if node is already running
if node_is_up; then
    echo -e "${YELLOW}⚠ A node is already listening on ${RPC_URL}; reusing it.${NC}"
    echo -e "${YELLOW}  It must be a dev chain with the standard test accounts funded.${NC}"
    echo -e "${YELLOW}  Set E2E_RPC_PORT to use a different port instead.${NC}"
else
    echo -e "${GREEN}📦 Starting Hardhat node on ${RPC_URL}...${NC}"
    cd "$CONTRACTS_DIR"
    # --port must be passed through, otherwise the node always binds 8545 while
    # everything else follows E2E_RPC_PORT.
    # `setsid` gives the node its own process group, so cleanup can kill the
    # whole tree (wrapper + real hardhat process) without the group ever
    # containing this script.
    #
    # Its output goes to a log rather than the console: the chain's block spam
    # interleaves with the test report, and on shutdown the node's own pnpm
    # wrapper prints "ELIFECYCLE Command failed" as it is killed - which reads
    # like the run failed even when every test passed and the script exits 0.
    setsid pnpm run node:local --port "$RPC_PORT" >"$NODE_LOG" 2>&1 &
    NODE_PID=$!

    # Resolve the group the node actually landed in. Guard against ever
    # matching this script's own group: killing that would take the run down.
    OWN_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
    for _ in 1 2 3 4 5; do
        NODE_PGID="$(ps -o pgid= -p "$NODE_PID" 2>/dev/null | tr -d ' ')"
        [ -n "$NODE_PGID" ] && break
        sleep 0.2
    done
    if [ -z "$NODE_PGID" ] || [ "$NODE_PGID" = "$OWN_PGID" ]; then
        NODE_PGID=""
    fi

    # Wait for node to be ready
    echo "Waiting for Hardhat node to be ready..."
    for i in {1..30}; do
        if node_is_up; then
            echo -e "${GREEN}✓ Hardhat node is ready${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}✗ Hardhat node failed to start${NC}"
            echo -e "${RED}  Node output: ${NODE_LOG}${NC}"
            tail -20 "$NODE_LOG" 2>/dev/null || true
            exit 1
        fi
        sleep 1
    done
fi

# Compile contracts
echo -e "\n${GREEN}📋 Compiling contracts...${NC}"
cd "$CONTRACTS_DIR"
pnpm compile

# Deploy contracts
echo -e "\n${GREEN}📋 Deploying contracts to localhost...${NC}"
cd "$CONTRACTS_DIR"
pnpm run deploy localhost --skip-prompts

# Export deployments
echo -e "\n${GREEN}📋 Exporting deployments...${NC}"
cd "$CONTRACTS_DIR"
pnpm export localhost --ts ../web/src/lib/deployments.ts
echo -e "${GREEN}✓ Contracts deployed and exported${NC}"

# Build web app
echo -e "\n${GREEN}🔨 Building web app...${NC}"
cd "$WEB_DIR"
# Pin the e2e build to wallet-only sign-in. Exported shell env has the highest
# priority in ldenv (it beats every .env file), so a developer's .env.local
# overrides (e.g. PUBLIC_WALLET_HOST for testing hosted sign-in) cannot leak
# into the e2e build, while manual `pnpm dev` remains free to use them.
#
# The suite still exercises the signer: TARGET_STEP is code, not env, so the
# build signs in either way and the demo sends through the local signer. What
# this pin removes is the hosted popup flow, which needs a service to talk to.
PUBLIC_WALLET_HOST= pnpm build localhost
echo -e "${GREEN}✓ Web app built${NC}"

# Run Playwright tests
echo -e "\n${GREEN}🧪 Running E2E tests...${NC}"
cd "$WEB_DIR"

# Run playwright without global-setup (we've done everything already)
# The webServer in playwright.config.ts will start the preview server
pnpm exec playwright test
TEST_EXIT_CODE=$?

echo -e "\n${GREEN}✅ E2E tests complete!${NC}"

# Return the test exit code
exit $TEST_EXIT_CODE
