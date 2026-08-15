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
 */
export async function claimViaApi(params: {
	publicClient: PublicClient;
	apiBase: string;
	address: `0x${string}`;
	chainId: number;
}): Promise<void> {
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
 * Funds the address that actually pays for transactions (the accountExecutor address):
 * the wallet/owner in wallet mode, the local signer in signer mode.
 */
export async function claimFaucet(
	deps: FaucetClaimDeps,
	config: {faucetApi?: string; faucetLink: string},
): Promise<void> {
	const {
		accountExecutor,
		accountBalance,
		deployments,
		publicClient,
		balanceCheck,
	} = deps;

	const $accountExecutor = get(accountExecutor);
	const address =
		$accountExecutor.status === 'ready' ? $accountExecutor.address : undefined;
	if (!address) {
		throw new Error(`no account for faucet`);
	}

	const chainId = get(deployments).chain.id;

	if (config.faucetApi && config.faucetApi.trim()) {
		await claimViaApi({
			publicClient,
			apiBase: config.faucetApi,
			address,
			chainId,
		});
	} else {
		await claimFund(
			{faucetUrl: config.faucetLink, chainId, address},
			{width: 600, height: 700},
		);
	}

	// Record pre-faucet balance before triggering update.
	const currentBalance = get(accountBalance);
	const preFaucetBalance =
		currentBalance.step === 'Loaded' ? currentBalance.value : 0n;
	// Trigger immediate balance refresh.
	accountBalance.update();
	// Notify the balance check store to poll for balance change.
	balanceCheck.markFaucetClaimed(preFaucetBalance);
}
