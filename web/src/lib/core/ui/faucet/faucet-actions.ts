import {get} from 'svelte/store';
import {claimFund} from 'faucet-client';
import type {PublicClient} from 'viem';
import type {Context} from '$lib/context/types';

/**
 * Build the faucet API claim endpoint URL from the configured API base,
 * tolerating a trailing slash.
 */
export function buildFaucetClaimUrl(apiBase: string): string {
	return apiBase.endsWith('/') ? `${apiBase}api/claim` : `${apiBase}/api/claim`;
}

/**
 * Validate a txHash returned by the faucet API.
 */
export function isValidTxHash(value: unknown): value is `0x${string}` {
	return typeof value === 'string' && value.startsWith('0x');
}

/**
 * Claim funds via the faucet HTTP API and wait for the resulting tx to be
 * included. Throws on any API/validation error.
 *
 * Returns the transaction, because WHAT THE FAUCET SENT is worth more than a
 * balance read afterwards: a wallet serves a cached balance until it sees a new
 * block, so asking it right after a claim routinely reports the old figure.
 */
export async function claimViaApi(params: {
	publicClient: PublicClient;
	apiBase: string;
	address: `0x${string}`;
	chainId: number;
}): Promise<`0x${string}`> {
	const {publicClient, apiBase, address, chainId} = params;

	// The faucet API expects POST /api/claim with JSON body {token, chainId, address}.
	// When captcha is disabled on server (DISABLE_CAPTCHA=true), token can be any value.
	const response = await fetch(buildFaucetClaimUrl(apiBase), {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({
			token: 'direct-api-call', // Dummy token for captcha-disabled mode
			chainId: String(chainId),
			address,
		}),
	});

	const data = await response.json();

	if (!response.ok) {
		throw new Error(`Faucet API error: ${data.error || response.statusText}`);
	}

	if (!isValidTxHash(data.txHash)) {
		throw new Error('Invalid txHash returned from faucet API');
	}

	await publicClient.waitForTransactionReceipt({hash: data.txHash});
	return data.txHash;
}

/**
 * How much a claim actually dispensed, read from its own transaction.
 *
 * The point of asking the CHAIN about the transaction rather than asking the
 * wallet for a balance: an injected wallet answers `eth_getBalance` from a
 * cache until it sees a new block, so a balance read straight after a faucet
 * claim reports the balance from before it. The transaction's value is a fact
 * that does not go stale.
 *
 * Undefined when it cannot be read, which is a reason to fall back to the
 * balance rather than to fail: the money did arrive either way.
 */
export async function dispensedByClaim(params: {
	publicClient: PublicClient;
	txHash: `0x${string}` | undefined;
}): Promise<bigint | undefined> {
	if (!params.txHash) return undefined;
	try {
		const tx = await params.publicClient.getTransaction({hash: params.txHash});
		return tx.value;
	} catch (error) {
		console.error('Could not read what the faucet sent', error);
		return undefined;
	}
}

export type FaucetClaimDeps = Pick<
	Context,
	| 'accountExecutor'
	| 'accountBalance'
	| 'deployments'
	| 'publicClient'
	| 'balanceCheck'
>;

/**
 * Full faucet claim flow: claim (via API when configured, otherwise the popup
 * flow), then refresh balance and notify the balance-check store so it can poll
 * for the balance change. Throws on failure.
 *
 * Funds the AUTHENTICATED ACCOUNT by default, and never the local signer. The
 * signer is funded by buying credits through the payment connection (see
 * lib/ui/credits), which is the flow a real deployment uses; pointing the
 * faucet at the signer would let local development take a shortcut that
 * production does not have, and hide the flow that matters.
 *
 * `target` overrides the address, for the one account that is neither of those:
 * the PAYER behind the payment connection. Buying credits needs a funded payer,
 * and on a local chain that payer is a fresh empty account, so without this the
 * flow is impossible to exercise. It still goes through the purchase, which is
 * the point; the faucet only supplies the money the purchase spends.
 */
export async function claimFaucet(
	deps: FaucetClaimDeps,
	config: {faucetApi?: string; faucetLink: string},
	target?: `0x${string}`,
): Promise<{txHash?: `0x${string}`; dispensed?: bigint}> {
	const {
		accountExecutor,
		accountBalance,
		deployments,
		publicClient,
		balanceCheck,
	} = deps;

	const $executor = get(accountExecutor);
	const executorAddress =
		$executor.status === 'ready' ? $executor.address : undefined;
	const address = target ?? executorAddress;
	if (!address) {
		throw new Error(`no account for faucet`);
	}

	const chainId = get(deployments).chain.id;

	// Both paths hand back the transaction they sent, which is what lets a caller
	// know how much arrived without asking a wallet that may still be answering
	// from cache.
	let txHash: `0x${string}` | undefined;
	if (config.faucetApi && config.faucetApi.trim()) {
		txHash = await claimViaApi({
			publicClient,
			apiBase: config.faucetApi,
			address,
			chainId,
		});
	} else {
		const claimed = await claimFund(
			{faucetUrl: config.faucetLink, chainId, address},
			{width: 600, height: 700},
		);
		txHash = isValidTxHash(claimed) ? claimed : undefined;
	}

	const dispensed = await dispensedByClaim({publicClient, txHash});

	// Record pre-faucet balance before triggering update.
	const currentBalance = get(accountBalance);
	const preFaucetBalance =
		currentBalance.step === 'Loaded' ? currentBalance.value : 0n;
	// Trigger immediate balance refresh.
	accountBalance.update();

	// Only tell the balance-check store when the account it MEASURES was funded.
	// It polls for a change to unblock a transaction that could not be afforded;
	// pointing it at a claim made for the payer would leave it waiting for a
	// change that is never coming, and then inviting the user to continue into
	// the same failure.
	// Case-insensitively: these two arrive from different places (one from the
	// caller, one from the executor) and an address that differs only in casing is
	// the same account. A strict compare here would silently skip the notice and
	// leave a blocked transaction waiting for a change it had already been told
	// about.
	if (address.toLowerCase() === executorAddress?.toLowerCase()) {
		balanceCheck.markFundingRequested(preFaucetBalance);
	}

	return {txHash, dispensed};
}
