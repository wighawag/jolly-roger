import {get} from 'svelte/store';
import {
	InsufficientFundsError,
	isInsufficientFundsFailure,
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
	| {
			status: 'cannot-pay';
			/** Whether the top-up flow is the remedy for THIS account. */
			canTopUp: boolean;
			message: string;
			details: string;
	  }
	| {status: 'error'; message: string; details: string};

export type SetGreetingDeps = Pick<
	Context,
	| 'connection'
	| 'signerExecutor'
	| 'signerBalance'
	| 'hasLocalSigner'
	| 'deployments'
	| 'balanceCheck'
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
 * - `cannot-pay`: the transaction was sent and the account could not pay for
 *   it, which is the one failure with a remedy attached.
 * - `error`: a real failure, with a user-facing message.
 */
export async function setGreeting(
	deps: SetGreetingDeps,
	message: string,
): Promise<SetGreetingResult> {
	// `signerExecutor`, explicitly: this is the app acting for the user, which is
	// what the local signer is for, and it sends without a wallet prompt. Sending
	// a greeting is not the user's money moving, so it never wants
	// `accountExecutor`. An app whose TARGET_STEP is 'WalletConnected' has no
	// signer, so this executor never becomes ready and the UI says so, rather
	// than silently prompting for something the user did not ask to sign.
	const {
		connection,
		signerExecutor,
		signerBalance,
		hasLocalSigner,
		deployments,
		balanceCheck,
	} = deps;

	const trimmed = message.trim();
	if (!trimmed) return {status: 'cancelled'};

	try {
		await connection.ensureConnected();
		const $deployments = get(deployments);

		const $executor = get(signerExecutor);
		if ($executor.status === 'cannot-send') return {status: 'cannot-send'};
		if ($executor.status !== 'ready') {
			// Not-ready has two very different causes, and they must not be
			// conflated. Mid-connection is transient and silence is right. But an
			// app whose TARGET_STEP is 'WalletConnected' has no signer and never
			// will, so staying silent would leave a Send button that does nothing,
			// forever, with no way to find out why.
			if (!hasLocalSigner) {
				return {
					status: 'error',
					message: 'This app cannot send greetings.',
					details:
						'This call site sends through the local signer, and TARGET_STEP is ' +
						"'WalletConnected', so there is no signer to send from. Either set " +
						"TARGET_STEP to 'SignedIn' (see core/connection/mode.ts), or change " +
						'this call site to use accountExecutor and send from the user' +
						"'s own account with a wallet prompt.",
				};
			}
			return {status: 'cancelled'};
		}

		const contractRequest = await balanceCheck.ensureCanAfford(
			{
				contract: {
					address: $deployments.contracts.GreetingsRegistry.address,
					abi: $deployments.contracts.GreetingsRegistry.abi,
					functionName: 'setMessage',
					args: [trimmed],
					account: $executor.account,
				},
			},
			// Measured against the SIGNER's gas, because the signer is what pays.
			{balance: signerBalance, sender: $executor.address},
		);

		await $executor.client.writeContract(contractRequest);
		return {status: 'submitted'};
	} catch (error) {
		if (
			error instanceof InsufficientFundsError ||
			isUserRejectionError(error)
		) {
			// User dismissed the funds modal or rejected in their wallet.
			return {status: 'cancelled'};
		}

		// Strictly after the two checks above, which is the ordering the classifier
		// warns about: a dismissed funds modal IS an account that cannot pay, and it
		// is still a cancellation, because the user was already shown the shortfall
		// and said no. This branch is the case nobody was offered anything for - the
		// pre-flight estimate passed and the node refused it anyway, which is what
		// happens when the signer's balance moves between the two.
		if (isInsufficientFundsFailure(error)) {
			console.error('Failed to set greeting, account cannot pay:', error);
			return {
				status: 'cannot-pay',
				// Only when a local signer is what sent it. Topping up funds the
				// signer, so on the wallet fallback it would move money nobody was
				// waiting on and the transaction would fail again - the same trap
				// `canTopUp` exists for on the pre-flight modal.
				canTopUp: hasLocalSigner,
				message: txErrorSummary(error),
				details: txErrorDetails(error),
			};
		}

		console.error('Failed to set greeting:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
