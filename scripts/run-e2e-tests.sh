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

# Track PIDs for cleanup
NODE_PID=""

# Cleanup function to kill background processes
#
# Only ever stops what THIS run started. Port 8545 (and 4173) may belong to a
# node or server the developer is using for something else, and blanket
# `lsof -ti:<port> | xargs kill -9` / `pkill -f hardhat` would take those down
# too - including another project's chain, mid-session.
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"

    # Kill the Hardhat node if we started it
    if [ -n "$NODE_PID" ]; then
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

# Check if node is already running
if curl -s -X POST http://localhost:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ A node is already listening on 8545; reusing it.${NC}"
    echo -e "${YELLOW}  It must be a dev chain with the standard test accounts funded.${NC}"
else
    echo -e "${GREEN}📦 Starting Hardhat node...${NC}"
    cd "$CONTRACTS_DIR"
    pnpm run node:local &
    NODE_PID=$!
    
    # Wait for node to be ready
    echo "Waiting for Hardhat node to be ready..."
    for i in {1..30}; do
        if curl -s -X POST http://localhost:8545 \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Hardhat node is ready${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}✗ Hardhat node failed to start${NC}"
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
# Pin the e2e build to the default wallet-mode configuration. Exported shell
# env has the highest priority in ldenv (it beats every .env file), so a
# developer's .env.local overrides (e.g. PUBLIC_WALLET_HOST for testing hosted
# sign-in) cannot leak into the e2e build, while manual `pnpm dev` remains
# free to use them.
PUBLIC_WALLET_HOST= PUBLIC_EXECUTION_MODE= pnpm build localhost
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
