/**
 * Detect when the connected wallet has a STALE CACHED NONCE for the current
 * chain, which makes it broadcast transactions that can never mine.
 *
 * The failure mode (common in local dev): you restart your dev node (Hardhat/
 * Anvil), which resets every account's nonce back to what the fresh chain
 * expects. The wallet (MetaMask/Rabby) still remembers the higher nonce from
 * the previous session, so it signs and "sends" transactions with a nonce that
 * is AHEAD of the node. The node holds them as un-mineable future-nonce txs,
 * the wallet returns a locally-computed hash, and the transaction sits pending
 * forever, never appearing on-chain. Bumping gas does not help.
 *
 * There are two ways to spot it, and they catch different wallets:
 *
 * 1. GROUND TRUTH, from an actually-broadcast tx (see {@link isStrandedNonce}).
 *    A pending transaction whose nonce is ABOVE the node's next expected nonce
 *    can never mine. This is what actually happened and works for every wallet,
 *    including Rabby (which proxies `eth_getTransactionCount` to the node, so a
 *    pre-send poll below sees a healthy value even while it broadcasts stale).
 *    Prefer this signal; it needs a real sent tx and the node's pending nonce.
 *
 * 2. PRE-SEND POLL (see {@link detectNonceCache}). Fetch the account's `pending`
 *    nonce from BOTH the wallet provider and the node; if the wallet's is
 *    higher, it is ahead. This catches wallets (older MetaMask) that report
 *    their locally-tracked nonce, but NOT wallets that proxy the read to the
 *    node (Rabby). Kept as a best-effort early signal.
 *
 * A sibling symptom is the wallet caching a block height beyond the node's
 * (again after a node restart): the wallet then answers nonce queries against a
 * block the node no longer has, and rejects with a "block out of range" / "invalid
 * block tag" error. We report that separately so the UI can explain it too.
 *
 * This is a pure module: it takes the two data sources as callbacks so it stays
 * trivially testable and free of viem/provider construction concerns. Gating
 * (dev-only, app-RPC-only) lives in the store that drives it, not here.
 *
 * Validated mainly against Rabby; the pre-send poll below does not work for all
 * wallets. Potential improvements (a proactive genesis-hash chain-reset detector,
 * and trimming the poll pending more wallet coverage) are captured in
 * work/notes/ideas/genesis-hash-nonce-cache-detector.md.
 */

export type NonceCacheStatus =
	/** Wallet nonce is ahead of the node: stale cached nonce, reset the account. */
	| 'cache'
	/** Wallet rejected the query against a block the node no longer has. */
	| 'block-out-of-range'
	/** Checked and healthy: wallet and node agree. */
	| false
	/** Could not decide (missing node RPC, provider/node error): stay silent. */
	| undefined;

/** Minimal EIP-1193-ish surface we need from the wallet provider. */
export type NonceCacheProvider = {
	request(args: {method: string; params?: unknown[]}): Promise<unknown>;
};

/**
 * True when an error looks like the wallet answering a query against a block the
 * node no longer has after a restart (the "block out of range" symptom). Covers
 * MetaMask's `BlockOutOfRangeError` and the generic "invalid block tag" wording.
 */
export function isBlockOutOfRangeError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const {code, message} = err as {code?: unknown; message?: unknown};
	// MetaMask surfaces these as an internal JSON-RPC error (-32603).
	if (code !== undefined && code !== -32603) return false;
	if (typeof message !== 'string') return false;
	return (
		message.indexOf('BlockOutOfRangeError') >= 0 ||
		message.indexOf('Received invalid block tag') >= 0 ||
		message.toLowerCase().indexOf('invalid block tag') >= 0
	);
}

function toNumber(v: unknown): number | undefined {
	if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
	if (typeof v === 'bigint') return Number(v);
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/**
 * Ask the wallet provider for `eth_getTransactionCount(address, 'pending')`.
 *
 * We query with BOTH the lowercase and the checksummed address, because
 * MetaMask has historically returned different (stale) values depending on the
 * address casing (see MetaMask/metamask-extension#19183). We use the MAXIMUM of
 * the two: the highest nonce the wallet believes in is the one that will drive a
 * doomed broadcast, so it is the one worth comparing against the node.
 *
 * Returns `{ nonce }` on success, `{ blockOutOfRange: true }` if either query
 * rejects with the block-out-of-range symptom, or `{}` if it could not tell.
 */
export async function readWalletNonce(
	provider: NonceCacheProvider,
	address: `0x${string}`,
): Promise<{nonce?: number; blockOutOfRange?: boolean}> {
	const variants = [address.toLowerCase(), address] as const;
	let best: number | undefined;
	for (const addr of variants) {
		try {
			const raw = await provider.request({
				method: 'eth_getTransactionCount',
				params: [addr, 'pending'],
			});
			const n = toNumber(raw);
			if (n !== undefined) best = best === undefined ? n : Math.max(best, n);
		} catch (err) {
			if (isBlockOutOfRangeError(err)) return {blockOutOfRange: true};
			// Any other provider error: we simply can't use this variant.
		}
	}
	return {nonce: best};
}

/**
 * Compare wallet vs node pending nonce and classify.
 *
 * @param readNode  Fetches the account's `pending` nonce from the TRUSTED node
 *   RPC (a direct JSON-RPC call, not through the wallet). Returns `undefined`
 *   when it cannot fetch, in which case we stay silent (no false alarm).
 */
/**
 * GROUND-TRUTH detection from an actually-broadcast transaction.
 *
 * A transaction that is still pending (not yet mined) but whose nonce is ABOVE
 * the node's next expected nonce can never be mined: the nonces between the
 * node's pending value and this tx's nonce will never arrive, so it is stranded
 * in the mempool as a future-nonce tx. That is exactly the stale-cached-nonce
 * bug, observed directly, and it works for any wallet regardless of what its
 * `eth_getTransactionCount` returns.
 *
 * @param txNonce       The broadcast transaction's actual nonce (from the tracker
 *   / observer, i.e. read back from chain, not what the app intended).
 * @param nodePending   The node's `pending` transaction count for the sender
 *   (its next expected nonce). `undefined` => cannot decide, returns false.
 * @param pending       Whether the tx is still pending (not included/dropped).
 *   Only pending txs can be "stranded"; a mined one is moot.
 */
export function isStrandedNonce(params: {
	txNonce: number | undefined;
	nodePending: number | undefined;
	pending: boolean;
}): boolean {
	const {txNonce, nodePending, pending} = params;
	if (!pending) return false;
	if (txNonce === undefined || nodePending === undefined) return false;
	return txNonce > nodePending;
}

export async function detectNonceCache(params: {
	provider: NonceCacheProvider;
	address: `0x${string}`;
	readNode: () => Promise<number | undefined>;
}): Promise<NonceCacheStatus> {
	const {provider, address, readNode} = params;

	const wallet = await readWalletNonce(provider, address);
	if (wallet.blockOutOfRange) return 'block-out-of-range';

	const nodeNonce = await readNode();

	// If either side is unknown, we cannot make a confident call: stay silent so
	// we never nag on a transient hiccup.
	if (wallet.nonce === undefined || nodeNonce === undefined) return undefined;

	return wallet.nonce > nodeNonce ? 'cache' : false;
}

/**
 * Build a `readNode` that fetches `eth_getTransactionCount(address, 'pending')`
 * from a node RPC URL over plain `fetch`. Returns `undefined` on any failure
 * (network error, non-2xx, JSON-RPC error) so detection stays silent rather
 * than false-alarming.
 */
export function nodeNonceReader(
	rpcUrl: string,
	address: `0x${string}`,
): () => Promise<number | undefined> {
	return async () => {
		try {
			const res = await fetch(rpcUrl, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					id: Date.now(),
					jsonrpc: '2.0',
					method: 'eth_getTransactionCount',
					params: [address, 'pending'],
				}),
			});
			if (!res.ok) return undefined;
			const json = (await res.json()) as {result?: unknown; error?: unknown};
			if (json.error || json.result === undefined) return undefined;
			return toNumber(json.result);
		} catch {
			return undefined;
		}
	};
}
