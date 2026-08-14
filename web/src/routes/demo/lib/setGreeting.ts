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
import {connectionRefusal} from '$lib/core/connection/refusal';
import {NotRegisteredError} from '$lib/ui/delegation/delegation-check';

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
	| 'delegation'
	| 'delegationCheck'
>;

/**
 * Submit a `setMessageFor` transaction to the GreetingsRegistry.
 *
 * `setMessageFor(owner, message)`, not `setMessage(message)`: the signer sends
 * it, but the greeting belongs to the ACCOUNT. The registry attributes it to
 * the owner the sender is acting for, which is the whole point of registering
 * the signer as a delegate - otherwise every greeting is filed under a key the
 * user never chose and cannot be recognised by.
 *
 * Owns the whole onchain flow (ensure connected, delegation check, balance
 * check, write) and normalises outcomes so the component only has to render:
 * - `submitted`: the tx was sent.
 * - `cancelled`: the user dismissed the funds modal, rejected in-wallet, or
 *   never got signed in (no error should be shown HERE - see the catch).
 * - `cannot-send`: the connected account cannot send under the configured
 *   execution mode (e.g. an email/social account in wallet execution mode).
 * A signer that may not act for the account yet does not fail here: the send
 *   WAITS while the user authorises this browser (one transaction, which funds
 *   the signer too) and then resumes on their say-so. Checked before sending
 *   rather than discovered as a `NotDelegate` revert, which costs a transaction
 *   and says nothing the user can act on. Backing out of that is a
 *   `cancelled`, exactly as backing out of the funds modal is.
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
		delegation,
		delegationCheck,
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

		// The account the greeting belongs to, and the one the registry will record.
		const $connection = get(connection);
		const owner =
			'account' in $connection ? $connection.account.address : undefined;
		if (!owner) return {status: 'cancelled'};

		// Asked BEFORE sending. The registry reverts with `NotDelegate` when the
		// sender may not act for the owner, and a revert is a transaction spent to
		// learn something a read already knows.
		//
		// This BLOCKS rather than returning: if the browser is not authorised yet it
		// walks the user through authorising it and resolves when they choose to
		// carry on, so the greeting they typed is still the greeting that gets sent.
		await delegationCheck.ensureRegistered({
			signer: $executor.address,
			// This app's half of the question asked at the end: what the action is
			// called, and the greeting itself, shown back to them. The gate supplies
			// the other half (what changed), and knows nothing about greetings.
			resume: {action: 'Send your greeting', detail: trimmed},
		});

		const contractRequest = await balanceCheck.ensureCanAfford(
			{
				contract: {
					address: $deployments.contracts.GreetingsRegistry.address,
					abi: $deployments.contracts.GreetingsRegistry.abi,
					functionName: 'setMessageFor',
					args: [owner, trimmed],
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
			error instanceof NotRegisteredError ||
			isUserRejectionError(error)
		) {
			// User dismissed the funds modal, backed out of authorising this browser,
			// or rejected in their wallet. All three are answers, not failures.
			return {status: 'cancelled'};
		}

		// A CONNECTION THAT DID NOT HAPPEN IS NOT A TRANSACTION THAT FAILED, and it
		// is not this call site's to report either way. `ensureConnected` rejects
		// with a `ConnectionFailure` whose reason (a closed popup, a declined
		// required permission, a blocked origin) is already resting on the
		// connection, where core/connection/ConnectionFlow renders it in the app's
		// own words - and that component is mounted for the life of the app, so it
		// cannot be missed. Falling through to the toast below said all of them the
		// same way, as "Transaction failed: Connection cancelled", about a
		// transaction that was never built, on top of the modal that had just
		// explained it properly.
		if (connectionRefusal(error)) return {status: 'cancelled'};

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
