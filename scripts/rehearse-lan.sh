#!/usr/bin/env bash
# Rehearse this repo's LAN package the way a LAN box (github:wighawag/ethereum-lan-node)
# runs it, on this machine, and run the e2e suite against it with no internet.
#
#   bash scripts/rehearse-lan.sh                       the faucet suite (an empty burner's first action)
#   bash scripts/rehearse-lan.sh e2e/tests/x.e2e.ts    a game's own suites, as playwright arguments
#
# What it starts, each in its own process group, all stopped on exit:
#
#   geth      from the box's genesis, as the box starts it (--dev, a block every
#             2 seconds, hash state scheme), on <LAN address>:8545
#   deploy    the package's own deploy command, run TWICE (the second must
#             deploy nothing: the box runs it on every boot)
#   faucet    the box's faucet-server, on <LAN address>:34010
#   caddy     the package's web/, with the box's rule, on <LAN address>:<port>
#
# On the LAN address, not localhost, because that is how a phone reaches a box:
# plain http on an address that is not localhost is an INSECURE context, and
# the app has to work there. The ports are the box's own because web/.env.lan
# names them (`//:8545`, `//:34010`).
#
# The browser can resolve no host but the LAN address (playwright.lan.config.ts),
# and the suite funds by transfer, since geth has no hardhat_setBalance
# (e2e/fixtures/test.ts).
#
# Environment:
#   E2E_LAN_PACKAGE    a built package to use instead of `nix build .#lan`
#   E2E_LAN_NODE       the box's flake (default github:wighawag/ethereum-lan-node),
#                      for its genesis, its faucet and its nixpkgs (geth, caddy)
#   E2E_LAN_IP         the address to serve on (default: the one the default route uses)
#   E2E_LAN_WEB_PORT   the page's port (default 28600)
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_FLAKE="${E2E_LAN_NODE:-github:wighawag/ethereum-lan-node}"
LAN_IP="${E2E_LAN_IP:-$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')}"
WEB_PORT="${E2E_LAN_WEB_PORT:-28600}"
RPC_PORT=8545
FAUCET_PORT=34010
MNEMONIC="test test test test test test test test test test test junk"
# Account 0 of that mnemonic, which the box's faucet pays from.
FAUCET_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

if [ -z "$LAN_IP" ]; then
	echo -e "${RED}✗ No LAN address found; set E2E_LAN_IP.${NC}"
	exit 1
fi

# A port is taken if anything listens on it on this address or on all of them.
port_taken() {
	ss -ltnH | awk '{print $4}' | grep -qE "^(${LAN_IP//./\\.}|0\.0\.0\.0|\*|\[::\]):$1\$"
}
AUTH_PORT=28700
while port_taken "$AUTH_PORT" || ss -ltnH | awk '{print $4}' | grep -qE ":$AUTH_PORT\$"; do
	AUTH_PORT=$((AUTH_PORT + 1))
done
for port in "$RPC_PORT" "$FAUCET_PORT" "$WEB_PORT"; do
	if port_taken "$port"; then
		echo -e "${RED}✗ Port ${port} is already in use on ${LAN_IP}: see \`ss -ltnp\`.${NC}"
		exit 1
	fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/$(basename "$REPO_DIR")-lan-rehearsal.XXXX")"
PGIDS=()
cleanup() {
	echo -e "\n${YELLOW}🧹 Stopping what this rehearsal started...${NC}"
	for pgid in "${PGIDS[@]}"; do
		kill -- "-$pgid" 2>/dev/null || true
	done
	sleep 1
	for pgid in "${PGIDS[@]}"; do
		kill -9 -- "-$pgid" 2>/dev/null || true
	done
	if [ -n "${E2E_KEEP_LAN_REHEARSAL:-}" ]; then
		echo "Logs kept in ${WORK}"
	else
		rm -rf "$WORK"
	fi
}
trap cleanup EXIT

# Start a command in a process group of its own and remember the group.
start() { # <name> <command...>
	local name=$1
	shift
	setsid "$@" >"$WORK/$name.log" 2>&1 &
	local pid=$!
	local pgid=""
	for _ in $(seq 1 25); do
		pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
		[ -n "$pgid" ] && [ "$pgid" != "$(ps -o pgid= -p $$ | tr -d ' ')" ] && break
		pgid=""
		sleep 0.2
	done
	if [ -z "$pgid" ]; then
		kill "$pid" 2>/dev/null || true
		echo -e "${RED}✗ Could not find ${name}'s process group.${NC}"
		exit 1
	fi
	PGIDS+=("$pgid")
}

wait_for() { # <name> <url>
	for _ in $(seq 1 60); do
		if curl -s -o /dev/null -m 2 "$2"; then return 0; fi
		sleep 0.5
	done
	echo -e "${RED}✗ ${1} did not come up: ${WORK}/${1}.log${NC}"
	tail -20 "$WORK/$1.log" || true
	exit 1
}

echo -e "${GREEN}📦 The package and the box's pieces...${NC}"
PKG="${E2E_LAN_PACKAGE:-$(nix build --no-link --print-out-paths "git+file://${REPO_DIR}#lan")}"
GENESIS="$(nix build --no-link --print-out-paths "${NODE_FLAKE}#genesis")"
FAUCET="$(nix build --no-link --print-out-paths "${NODE_FLAKE}#faucet-server")/bin/faucet"
GETH="$(nix build --no-link --print-out-paths --inputs-from "$NODE_FLAKE" nixpkgs#go-ethereum)/bin/geth"
CADDY="$(nix build --no-link --print-out-paths --inputs-from "$NODE_FLAKE" nixpkgs#caddy)/bin/caddy"
DEPLOY="$(ls -d "$PKG"/bin/* 2>/dev/null | head -1)"
if [ -z "$DEPLOY" ]; then
	echo -e "${RED}✗ ${PKG}/bin has no deploy command.${NC}"
	exit 1
fi
CHAIN_ID="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).chainId))' "$(ls "$PKG"/share/*/lan.transactions.json | head -1)")"

echo -e "${GREEN}⛓  geth on ${LAN_IP}:${RPC_PORT}...${NC}"
"$GETH" --datadir "$WORK/chain" --state.scheme hash init "$GENESIS" >"$WORK/geth-init.log" 2>&1
start geth "$GETH" --dev --dev.period 2 --datadir "$WORK/chain" \
	--state.scheme hash --gcmode archive --syncmode full \
	--http --http.addr "$LAN_IP" --http.port "$RPC_PORT" \
	--http.vhosts '*' --http.corsdomain '*' --http.api eth,net,web3,debug,txpool \
	--rpc.allow-unprotected-txs \
	--authrpc.addr 127.0.0.1 --authrpc.port "$AUTH_PORT" \
	--port 0 --nodiscover --maxpeers 0
RPC_URL="http://${LAN_IP}:${RPC_PORT}"
wait_for geth "$RPC_URL"

echo -e "${GREEN}📜 $(basename "$DEPLOY"), twice...${NC}"
mkdir -p "$WORK/deploy"
for run in first second; do
	ETH_NODE_URI="$RPC_URL" MNEMONIC="$MNEMONIC" STATE_DIRECTORY="$WORK/deploy" "$DEPLOY" | tee "$WORK/deploy-$run.log"
done
if ! grep -q "(0 deployed now)" "$WORK/deploy-second.log"; then
	echo -e "${RED}✗ The second deploy deployed something: it must be idempotent.${NC}"
	exit 1
fi

echo -e "${GREEN}🚰 The box's faucet on ${LAN_IP}:${FAUCET_PORT}...${NC}"
mkdir -p "$WORK/faucet"
start faucet env -C "$WORK/faucet" \
	FAUCET_PRIVATE_KEY="$FAUCET_KEY" \
	"CHAIN_${CHAIN_ID}=1000000000000000000:${RPC_URL}" \
	DB="$WORK/faucet/faucet.db" CORS_ORIGINS='*' \
	"$FAUCET" --no-captcha --port "$FAUCET_PORT" --host "$LAN_IP"
wait_for faucet "http://${LAN_IP}:${FAUCET_PORT}"

echo -e "${GREEN}🌐 caddy serving the package on http://${LAN_IP}:${WEB_PORT}...${NC}"
cat >"$WORK/Caddyfile" <<EOF
{
	auto_https off
	admin off
}
http://${LAN_IP}:${WEB_PORT} {
	root * ${PKG}/web
	try_files {path} {path}/index.html {path}.html /404.html
	file_server
}
EOF
start caddy "$CADDY" run --config "$WORK/Caddyfile" --adapter caddyfile
wait_for caddy "http://${LAN_IP}:${WEB_PORT}/"

echo -e "\n${GREEN}🧪 The e2e suite, with no internet...${NC}"
cd "$REPO_DIR/web"
export E2E_LAN_IP="$LAN_IP"
export E2E_LAN_URL="http://${LAN_IP}:${WEB_PORT}"
export E2E_RPC_URL="$RPC_URL"
export E2E_FAUCET_URL="http://${LAN_IP}:${FAUCET_PORT}"
export E2E_FUNDING=transfer
export E2E_MNEMONIC="$MNEMONIC"
# Suites named on the command line are filtered from all of them.
[ $# -gt 0 ] && export E2E_LAN_TESTS="${E2E_LAN_TESTS:-**/*.e2e.ts}"
set +e
pnpm exec playwright test -c playwright.lan.config.ts "$@"
status=$?
set -e
echo -e "\n${GREEN}✅ LAN rehearsal complete (exit ${status})${NC}"
exit $status
