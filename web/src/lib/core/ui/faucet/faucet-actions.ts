import {get} from 'svelte/store';
import {claimFund} from 'faucet-client';
import {sameAddress} from '$lib/core/utils/ethereum/address';
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
 * `target` OVERRIDES THAT ADDRESS, for the one account that is neither of those:
 * a PAYER on the payment connection. That happens two ways, and they are worth
 * telling apart. Buying credits needs a funded payer, and on a local chain that
 * payer is a fresh empty account, so without this the flow is impossible to
 * exercise - it still goes through the purchase, which is the point, and the
 * faucet only supplies the money the purchase spends. The other way is that the
 * payer is what a blocked transaction is short ON, in which case this IS the
 * remedy rather than a step towards one, and the address to fund is the address
 * that is short. See `FundsRemedy` in core/transaction/insufficient-funds-view,
 * which carries it for exactly that reason.
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

	// Refresh the account's own displayed balance, when the account is what was
	// funded. A claim aimed elsewhere did not change it, and re-reading it would
	// only spend a request to learn that.
	if (sameAddress(address, executorAddress)) {
		accountBalance.update();
	}

	// Tell the balance check WHICH account was funded and let it decide whether
	// that is the one it is blocked on. This used to compare against the executor
	// here, and skip the notice for anything else - which was right for the two
	// payers that existed (a claim made for the PAYER mid-top-up must not unblock
	// a transaction waiting on the SIGNER) and wrong the moment a payer could be
	// the account that is short itself. The rule was never "is this the
	// executor", it was "is this the account the check is blocked on", and only
	// that store knows.
	balanceCheck.markFundingRequested(address);

	return {txHash, dispensed};
}
