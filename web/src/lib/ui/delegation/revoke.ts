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
	'accountExecutor' | 'publicClient' | 'delegation'
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
 * disposes of the re-registration dead end: `delegationWithdrawn` is only ever
 * set by a successful revoke for the delegate that was current at the time, so
 * an account that cannot revoke can never be blocked from registering by
 * signature, and a withdrawn delegate can be replaced by a different one.
 *
 * Waits for the receipt and refreshes the delegation read, so the panel says
 * what is true rather than what was true when the button was pressed.
 */
export async function revokeDelegation(
	deps: RevokeDeps,
): Promise<RevokeResult> {
	const {accountExecutor, publicClient, delegation} = deps;

	const $executor = get(accountExecutor);
	if ($executor.status === 'cannot-send') return {status: 'cannot-send'};
	if ($executor.status !== 'ready') return {status: 'cancelled'};

	// The contract the delegation state was READ from, rather than a second
	// lookup: withdrawing from anywhere else would leave the panel reporting an
	// authorisation that is still live. See onchain/delegation.
	const {registry} = delegation;

	try {
		const hash = await $executor.client.writeContract({
			address: registry.address,
			abi: registry.abi,
			functionName: 'revokeDelegate',
			args: [],
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
