import {get} from 'svelte/store';
import {isUserRejectionError} from '$lib/core/transaction';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import type {Context} from '$lib/context/types';

export type RevokeResult =
	| {status: 'revoked'}
	| {status: 'cancelled'}
	/** The account has no wallet, so it cannot send the transaction. */
	| {status: 'cannot-send'}
	| {status: 'error'; message: string; details: string};

export type RevokeDeps = Pick<
	Context,
	'accountExecutor' | 'publicClient' | 'delegation' | 'connection'
>;

/**
 * Withdraw this browser's authority to act for the account.
 *
 * THE REASON THE MECHANISM IS SAFE TO OFFER AT ALL. An authorisation the user
 * cannot withdraw is the failure delegation has to avoid, so `revokeDelegate`
 * is not left inherited-but-unreachable: it is a row in the account panel.
 *
 * An OWNER-SENT transaction, necessarily: the contract takes `msg.sender` as
 * the account withdrawing, so nobody can withdraw on the owner's behalf. An
 * account with no wallet therefore cannot call it, which is why the UI disables
 * it with an explanation rather than letting the click revert. That same fact
 * disposes of the re-registration dead end: the withdrawn flag is only ever set
 * by a successful revoke for the delegate it names, so an account that cannot
 * revoke can never be blocked from registering by signature, and a withdrawn
 * delegate can be replaced by a different one.
 *
 * WHICH delegate is an argument now, because an account may have several: this
 * withdraws THIS browser's signer and leaves the user's other browsers alone.
 * A bare `revokeDelegate()` could only have meant "whichever one the contract
 * thinks is current", which under a set is not a question with an answer.
 *
 * Waits for the receipt and refreshes the delegation read, so the panel says
 * what is true rather than what was true when the button was pressed.
 */
export async function revokeDelegation(
	deps: RevokeDeps,
): Promise<RevokeResult> {
	const {accountExecutor, publicClient, delegation, connection} = deps;

	const $executor = get(accountExecutor);
	if ($executor.status === 'cannot-send') return {status: 'cannot-send'};
	if ($executor.status !== 'ready') return {status: 'cancelled'};

	// The signer this browser holds, which is the one the panel just said may act
	// and therefore the one the user is asking to withdraw. Read from the
	// connection rather than passed in, so the address that was READ about and the
	// address written about are the same one.
	const $connection = get(connection);
	const delegate =
		$connection.step === 'SignedIn'
			? $connection.account.signer.address
			: undefined;
	if (!delegate) return {status: 'cancelled'};

	// The contract the delegation state was READ from, rather than a second
	// lookup: withdrawing from anywhere else would leave the panel reporting an
	// authorisation that is still live. See onchain/delegation.
	const {registry} = delegation;

	try {
		const hash = await $executor.client.writeContract({
			address: registry.address,
			abi: registry.abi,
			functionName: 'revokeDelegate',
			args: [delegate],
			account: $executor.account,
		});

		await publicClient.waitForTransactionReceipt({hash});
		await delegation.update();
		return {status: 'revoked'};
	} catch (error) {
		if (isUserRejectionError(error)) return {status: 'cancelled'};
		console.error('Failed to withdraw the delegation:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
