# This repo's contracts on a LAN box (github:wighawag/ethereum-lan-node).
#
# Replays, against the box's chain, the transactions the build recorded
# (contracts/scripts/deploy-lan-build.ts): each is a CREATE2 deployment through
# the deterministic-deployment proxy the box's genesis predeploys, so it lands
# at the address the web app was built with. Idempotent: a contract already
# there is skipped, so the box can run this on every boot and after a reset.
#
# Environment (set by the box): ETH_NODE_URI, MNEMONIC, STATE_DIRECTORY
# (optional, where addresses.json goes). Set by nix/lan.nix's wrapper:
# TRANSACTIONS, the recorded file, and NAME, this command's name for messages.
set -euo pipefail

name=${NAME:-lan-deploy}
expected=$(jq -r .chainId "$TRANSACTIONS")
factory=$(jq -r .factory "$TRANSACTIONS")
chain=$(cast chain-id --rpc-url "$ETH_NODE_URI")
if [ "$chain" != "$expected" ]; then
	echo "$name: the chain is $chain, the web app was built for $expected" >&2
	exit 1
fi
if [ "$(cast code --rpc-url "$ETH_NODE_URI" "$factory")" = "0x" ]; then
	echo "$name: no deterministic-deployment proxy at $factory" >&2
	exit 1
fi

count=$(jq '.transactions | length' "$TRANSACTIONS")
sent=0
for i in $(seq 0 $((count - 1))); do
	account=$(jq -r ".transactions[$i].account" "$TRANSACTIONS")
	address=$(jq -r ".transactions[$i].address" "$TRANSACTIONS")
	if [ "$(cast code --rpc-url "$ETH_NODE_URI" "$address")" = "0x" ]; then
		# salt ++ init code, as one argument: Linux allows 128 KiB for one, and
		# init code is at most 49152 bytes (EIP-3860), under 100k hex characters.
		data=$(jq -r ".transactions[$i].data" "$TRANSACTIONS")
		cast send --rpc-url "$ETH_NODE_URI" --mnemonic "$MNEMONIC" --mnemonic-index "$account" \
			"$factory" "$data" >/dev/null
		sent=$((sent + 1))
	fi
	if [ "$(cast code --rpc-url "$ETH_NODE_URI" "$address")" = "0x" ]; then
		echo "$name: nothing at $address after deploying it" >&2
		exit 1
	fi
done
jq '[.transactions[].address]' "$TRANSACTIONS" >"${STATE_DIRECTORY:-.}/addresses.json"
echo "$name: $count contracts on chain $chain ($sent deployed now)"
