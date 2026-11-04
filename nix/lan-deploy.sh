# This repo's contracts on a LAN box (github:wighawag/ethereum-lan-node).
#
# Replays, against the box's chain, the transactions the build recorded
# (contracts/scripts/deploy-lan-build.ts), in order:
#
# - a CREATE2 deployment through the deterministic-deployment proxy the box's
#   genesis predeploys, so it lands at the address the web app was built with;
#   skipped when that address already holds code;
# - a guarded setup call (contracts/scripts/lan/record.ts); skipped when its
#   guard (a view call, or a storage slot) already reads what the build read
#   after sending it.
#
# Idempotent, so the box can run this on every boot and after a reset, and each
# step is checked after it is sent.
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

# What a recorded call's guard reads now, normalised for comparison.
guard_reads() { # <index>
	local check kind to
	check=$(jq -c ".transactions[$1].check" "$TRANSACTIONS")
	kind=$(jq -r .kind <<<"$check")
	to=$(jq -r .to <<<"$check")
	if [ "$kind" = storage ]; then
		cast storage --rpc-url "$ETH_NODE_URI" "$to" "$(jq -r .slot <<<"$check")"
	else
		cast call --rpc-url "$ETH_NODE_URI" "$to" "$(jq -r .data <<<"$check")"
	fi | tr '[:upper:]' '[:lower:]'
}
guard_expects() { # <index>
	jq -r ".transactions[$1].check | if .kind == \"storage\" then .word else .result end" "$TRANSACTIONS" |
		tr '[:upper:]' '[:lower:]'
}

count=$(jq '.transactions | length' "$TRANSACTIONS")
contracts=0
sent=0
for i in $(seq 0 $((count - 1))); do
	account=$(jq -r ".transactions[$i].account" "$TRANSACTIONS")
	if [ "$(jq -r ".transactions[$i].kind // \"create2\"" "$TRANSACTIONS")" = call ]; then
		if [ "$(guard_reads "$i")" != "$(guard_expects "$i")" ]; then
			cast send --rpc-url "$ETH_NODE_URI" --mnemonic "$MNEMONIC" --mnemonic-index "$account" \
				--value "$(jq -r ".transactions[$i].value" "$TRANSACTIONS")" \
				"$(jq -r ".transactions[$i].to" "$TRANSACTIONS")" "$(jq -r ".transactions[$i].data" "$TRANSACTIONS")" >/dev/null
			sent=$((sent + 1))
			if [ "$(guard_reads "$i")" != "$(guard_expects "$i")" ]; then
				echo "$name: transaction $i to $(jq -r ".transactions[$i].to" "$TRANSACTIONS") did not take the effect its guard expects" >&2
				exit 1
			fi
		fi
		continue
	fi
	contracts=$((contracts + 1))
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
jq '[.transactions[] | select(.address) | .address]' "$TRANSACTIONS" >"${STATE_DIRECTORY:-.}/addresses.json"
calls=$((count - contracts))
echo "$name: $contracts contracts$([ "$calls" -gt 0 ] && echo " and $calls setup calls") on chain $chain ($sent sent now)"
