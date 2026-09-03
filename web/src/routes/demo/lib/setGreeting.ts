import {get} from 'svelte/store';
import {
	InsufficientFundsError,
	isStoppedWaitingError,
	isUserRejectionError,
} from '$lib/core/transaction';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import type {Context} from '$lib/context/types';
import {connectionRefusal, isUserDecision} from '$lib/core/connection/refusal';

export type SetGreetingResult =
	| {status: 'submitted'}
	| {status: 'cancelled'}
	| {status: 'cannot-send'}
	| {status: 'error'; message: string; details: string};

export type SetGreetingDeps = Pick<
	Context,
	| 'connection'
	| 'accountExecutor'
	| 'deployments'
	| 'balanceCheck'
	| 'accountBalance'
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
	const {
		connection,
		accountExecutor,
		deployments,
		balanceCheck,
		accountBalance,
	} = deps;

	const trimmed = message.trim();
	if (!trimmed) return {status: 'cancelled'};

	try {
		await connection.ensureConnected();
		const $deployments = get(deployments);

		const $accountExecutor = get(accountExecutor);
		if ($accountExecutor.status === 'cannot-send')
			return {status: 'cannot-send'};
		if ($accountExecutor.status !== 'ready') return {status: 'cancelled'};

		const contractRequest = await balanceCheck.ensureCanAfford(
			{
				contract: {
					address: $deployments.contracts.GreetingsRegistry.address,
					abi: $deployments.contracts.GreetingsRegistry.abi,
					functionName: 'setMessage',
					args: [trimmed],
					account: $accountExecutor.account,
				},
			},
			// Measured against the account that will send it. One account sends
			// everything here, so this is always the same one, but naming it is what
			// stops the check and the sender from ever disagreeing.
			{balance: accountBalance, sender: $accountExecutor.address},
		);

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

		// The user stopped waiting for a wallet that had not answered. NOT a
		// failure: the request is still with the wallet and may yet be sent, and
		// the in-flight ledger is following it. All this has to do is let the form
		// go, and say nothing, because an error toast here would be about a
		// transaction that has not failed. See StoppedWaitingError. The typed
		// message is deliberately left in the input: the user has not been told
		// anything happened, so taking their text away would be the app deciding
		// for them that it did.
		if (isStoppedWaitingError(error)) return {status: 'cancelled'};

		// Nor is any other way the connection came back empty an error to report
		// here. Every one of them already rests on the connection, where
		// core/connection/ConnectionFlow renders it in the app's own words, and that
		// component is mounted for the life of the app so it cannot be missed.
		// Falling through said all of them the same way, as "Transaction failed:
		// Connection cancelled", about a transaction that was never built, on top of
		// the modal that had just explained it properly.
		// ONLY A DECISION IS SILENT. This used to swallow every refusal, which was
		// right when the alternative was a raw "Connection cancelled" in a red
		// alert. Since @etherplay/connect 0.13.0 a failure says WHY, and two of
		// the reasons (`unreachable`, `superseded`) are answers the library went
		// to some trouble to produce instead of hanging: reporting them as a
		// cancellation turns that work back into silence.
		const refusal = connectionRefusal(error);
		if (refusal && isUserDecision(refusal)) return {status: 'cancelled'};
		console.error('Failed to set greeting:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
