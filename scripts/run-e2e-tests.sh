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

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# A run happens in a THROWAWAY GIT WORKTREE, never in the developer's checkout.
#
# The suite needs to compile, deploy to its own chain, export the deployment and
# build the app - and every one of those steps writes a file that a `pnpm start`
# session is also using:
#
#   contracts/generated        rewritten by `compile`; `deploy:watch` watches it
#                              and reacts by deploying to ITS chain
#   contracts/deployments/*    the deployment records, keyed by chain
#   web/src/lib/deployments.ts the exported addresses the app is built against,
#                              hot-reloaded by a running dev server
#   web/build                  the built app
#
# Sharing them means the two runs corrupt each other. The e2e run's records
# describe a chain that is deleted at exit, so a dev server left holding them
# points at contracts that no longer exist; and because the records carry that
# chain's genesis hash, the developer's next deploy sees a mismatch, wipes them
# and redeploys, discarding the deployment they had. In the other direction the
# dev session's deploy:watch rewrites the records and the exported module in the
# middle of this run, and the app gets built against ITS chain - which shows up,
# several tests deep, as "Failed to load messages" and reads returning "0x".
#
# A separate worktree removes the whole class of problem at once, without the
# app or the contracts config needing to know that e2e exists.
WORKTREE_DIR="${E2E_WORKTREE_DIR:-${TMPDIR:-/tmp}/$(basename "$REPO_DIR")-e2e-worktree}"
CONTRACTS_DIR="$WORKTREE_DIR/contracts"
WEB_DIR="$WORKTREE_DIR/web"

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

    # Rescue the report and traces before the worktree goes: they are written
    # inside it, and they are exactly what a failed run is consulted for. They
    # land where a developer expects them, in the real checkout.
    for artifact in playwright-report test-results; do
        if [ -d "$WEB_DIR/$artifact" ]; then
            rm -rf "${REPO_DIR:?}/web/$artifact"
            cp -r "$WEB_DIR/$artifact" "$REPO_DIR/web/$artifact"
        fi
    done

    if [ -d "$WORKTREE_DIR" ]; then
        if [ -n "${E2E_KEEP_WORKTREE:-}" ]; then
            echo -e "${YELLOW}Keeping the worktree: ${WORKTREE_DIR}${NC}"
            echo -e "${YELLOW}  Remove it with: git worktree remove --force ${WORKTREE_DIR}${NC}"
        else
            echo "Removing the e2e worktree..."
            git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 ||
                rm -rf "$WORKTREE_DIR"
            git -C "$REPO_DIR" worktree prune >/dev/null 2>&1 || true
        fi
    fi

    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Set up trap to ensure cleanup runs on exit (success or failure)
trap cleanup EXIT

echo -e "${GREEN}🚀 Starting E2E test setup...${NC}\n"

echo -e "${GREEN}🌳 Creating the e2e worktree at ${WORKTREE_DIR}...${NC}"

if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo -e "${RED}✗ ${REPO_DIR} is not a git checkout.${NC}"
    echo -e "${RED}  The suite runs in a git worktree so it cannot collide with a${NC}"
    echo -e "${RED}  dev session's deployments and generated files.${NC}"
    exit 1
fi

# Anything left by an interrupted run: the worktree is disposable by design, so
# it is always rebuilt rather than reused (a stale one would test stale code).
git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
rm -rf "$WORKTREE_DIR"
git -C "$REPO_DIR" worktree prune >/dev/null 2>&1 || true

# Detached: the branch is checked out in the developer's tree, and git refuses
# to have it in two worktrees at once.
git -C "$REPO_DIR" worktree add --detach "$WORKTREE_DIR" HEAD >/dev/null

# HEAD is not what the developer is looking at. Tests must run against the
# WORKING TREE - uncommitted work is the normal case, and a suite that quietly
# tested the last commit instead would be worse than no suite. Two transfers,
# because git tracks the two kinds of change differently.
UNCOMMITTED_PATCH="$(mktemp)"
git -C "$REPO_DIR" diff HEAD --binary >"$UNCOMMITTED_PATCH"
if [ -s "$UNCOMMITTED_PATCH" ]; then
    echo "  Applying uncommitted changes..."
    if ! git -C "$WORKTREE_DIR" apply "$UNCOMMITTED_PATCH"; then
        echo -e "${RED}✗ Could not apply the working tree's changes to the worktree.${NC}"
        rm -f "$UNCOMMITTED_PATCH"
        exit 1
    fi
fi
rm -f "$UNCOMMITTED_PATCH"

# Untracked but not ignored: a new source file that has not been `git add`ed yet
# is still part of what is being tested.
if [ -n "$(git -C "$REPO_DIR" ls-files --others --exclude-standard)" ]; then
    echo "  Copying untracked files..."
    (cd "$REPO_DIR" && git ls-files --others --exclude-standard -z |
        tar --null --files-from - --create --file -) |
        tar --extract --file - --directory "$WORKTREE_DIR"
fi

# Ignored, and still inputs: local env overrides (the run pins the variables it
# cares about, but the rest of a developer's configuration should still apply)
# and the PWA icons, which are generated by `pnpm install`'s prepare script and
# so are absent from a fresh worktree.
while IFS= read -r -d '' env_file; do
    target="$WORKTREE_DIR/${env_file#"$REPO_DIR"/}"
    mkdir -p "$(dirname "$target")"
    cp "$env_file" "$target"
done < <(find "$REPO_DIR" -maxdepth 2 -name '.env*.local' -not -path '*/node_modules/*' -print0)

if [ -d "$REPO_DIR/web/static/pwa" ]; then
    cp -r "$REPO_DIR/web/static/pwa" "$WEB_DIR/static/pwa"
else
    (cd "$WEB_DIR" && pnpm generate-pwa-icons)
fi

# Dependencies are LINKED, not installed again: the worktree is the same commit
# with the same lockfile, so a second install would spend a minute reproducing
# a tree that already exists. pnpm's layout survives this - every link inside
# node_modules is relative to its real path, which is still the main checkout.
for pkg in . web contracts; do
    if [ -d "$REPO_DIR/$pkg/node_modules" ]; then
        ln -s "$REPO_DIR/$pkg/node_modules" "$WORKTREE_DIR/$pkg/node_modules"
    else
        echo -e "${RED}✗ ${REPO_DIR}/$pkg/node_modules is missing. Run pnpm i first.${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓ Worktree ready${NC}"

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
#
# --no-compile: the step above just compiled, with the DEFAULT build profile.
# Without the flag the deploy task compiles again with the `production` profile
# instead, so every run pays for two full compiles and deploys bytecode that is
# not the bytecode just built.
echo -e "\n${GREEN}📋 Deploying contracts to localhost...${NC}"
cd "$CONTRACTS_DIR"
pnpm run deploy localhost --skip-prompts --no-compile

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

# Prove the build can reach the contracts before spending four minutes finding
# out through the UI.
#
# Every way the setup can go wrong ends identically: the app holds an address
# with no code on it, reads return "0x", and the suite fails several tests deep
# with "Failed to load messages" - a symptom that points at the app rather than
# at the setup. Two questions settle it in a second: is each exported address a
# contract on THIS run's chain, and is it the address the build shipped?
echo -e "\n${GREEN}🔎 Verifying the build points at this run's contracts...${NC}"

# The exported module is `export default {...} as const;`, i.e. JSON with a
# wrapper - parsed rather than grepped, so this reads the contracts' own
# addresses and not the first hex string that happens to look like one.
DEPLOYED_ADDRESSES="$(node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf-8");
  const json = src.replace(/^\s*export default\s*/, "").replace(/\s*as const;?\s*$/, "");
  const addresses = Object.values(JSON.parse(json).contracts || {}).map((c) => c.address);
  if (addresses.length === 0) throw new Error(`no contracts in ${process.argv[1]}`);
  console.log(addresses.join(" "));
' "$WEB_DIR/src/lib/deployments.ts")"

for address in $DEPLOYED_ADDRESSES; do
    CODE="$(curl -s -X POST "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$address\",\"latest\"],\"id\":1}")"
    if ! echo "$CODE" | grep -q '"result":"0x[0-9a-f]'; then
        echo -e "${RED}✗ No contract code at ${address} on ${RPC_URL}.${NC}"
        echo -e "${RED}  The exported deployment describes a different chain than${NC}"
        echo -e "${RED}  the one this run started, so every read will return 0x.${NC}"
        exit 1
    fi

    if ! grep -qri "$address" "$WEB_DIR/build" >/dev/null 2>&1; then
        echo -e "${RED}✗ The built app does not contain ${address}.${NC}"
        echo -e "${RED}  It was built against a different deployment than the one${NC}"
        echo -e "${RED}  just exported.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Build talks to ${address} on ${RPC_URL}${NC}"
done

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
