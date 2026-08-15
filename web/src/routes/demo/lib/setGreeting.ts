import {get} from 'svelte/store';
import {
	InsufficientFundsError,
	isUserRejectionError,
} from '$lib/core/transaction';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import type {Context} from '$lib/context/types';

export type SetGreetingResult =
	| {status: 'submitted'}
	| {status: 'cancelled'}
	| {status: 'cannot-send'}
	| {status: 'error'; message: string; details: string};

export type SetGreetingDeps = Pick<
	Context,
	'connection' | 'accountExecutor' | 'deployments' | 'balanceCheck'
>;

/**
 * Submit a `setMessage` transaction to the GreetingsRegistry.
 *
 * Owns the whole onchain flow (ensure connected, balance check, write) and
 * normalises outcomes so the component only has to render:
 * - `submitted`: the tx was sent.
 * - `cancelled`: the user dismissed the funds modal or rejected in-wallet
 *   (no error should be shown).
 * - `cannot-send`: the connected account cannot send under the configured
 *   execution mode (e.g. an email/social account in wallet execution mode).
 * - `error`: a real failure, with a user-facing message.
 */
export async function setGreeting(
	deps: SetGreetingDeps,
	message: string,
): Promise<SetGreetingResult> {
	const {connection, accountExecutor, deployments, balanceCheck} = deps;

	const trimmed = message.trim();
	if (!trimmed) return {status: 'cancelled'};

	try {
		await connection.ensureConnected();
		const $deployments = get(deployments);

		const $accountExecutor = get(accountExecutor);
		if ($accountExecutor.status === 'cannot-send')
			return {status: 'cannot-send'};
		if ($accountExecutor.status !== 'ready') return {status: 'cancelled'};

		const contractRequest = await balanceCheck.ensureCanAfford({
			contract: {
				address: $deployments.contracts.GreetingsRegistry.address,
				abi: $deployments.contracts.GreetingsRegistry.abi,
				functionName: 'setMessage',
				args: [trimmed],
				account: $accountExecutor.account,
			},
		});

		await $accountExecutor.client.writeContract(contractRequest);
		return {status: 'submitted'};
	} catch (error) {
		if (
			error instanceof InsufficientFundsError ||
			isUserRejectionError(error)
		) {
			// User dismissed the funds modal or rejected in their wallet.
			return {status: 'cancelled'};
		}
		console.error('Failed to set greeting:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
