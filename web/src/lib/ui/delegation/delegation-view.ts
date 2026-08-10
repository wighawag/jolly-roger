import {derived, type Readable} from 'svelte/store';
import type {Connection, UnderlyingEthereumProvider} from '@etherplay/connect';
import {isRegistered, type DelegationValue} from '$lib/onchain/delegation';
import type {Context} from '$lib/context/types';
import {delegationAccountOf} from './register-delegate';

/**
 * What the account panel says about this browser's authority, and whether the
 * user can withdraw it from here.
 *
 * Pure, so the combinations (no signer, not registered yet, registered but the
 * account cannot send) can be argued with in tests rather than by clicking
 * through sign-in mechanisms.
 */
export type DelegationRowView = {
	/** Whether the row renders at all. */
	visible: boolean;
	/** One line on the current state, in a player's terms. */
	status: string;
	/** Whether this browser is currently authorised. */
	authorised: boolean;
	/** Whether the withdraw action can be taken. */
	canRevoke: boolean;
	/**
	 * Why it cannot, when it cannot. Shown next to the disabled button: a
	 * disabled control with no reason is worse than no control.
	 */
	revokeBlockedReason: string | undefined;
};

const HIDDEN: DelegationRowView = {
	visible: false,
	status: '',
	authorised: false,
	canRevoke: false,
	revokeBlockedReason: undefined,
};

export function deriveDelegationRow(input: {
	/** The account and its signer, or undefined before sign-in. */
	owner: `0x${string}` | undefined;
	signer: `0x${string}` | undefined;
	delegation: DelegationValue;
	/** Whether the account can submit a transaction (i.e. it has a wallet). */
	ownerCanSend: boolean;
}): DelegationRowView {
	const {owner, signer, delegation, ownerCanSend} = input;

	// No signer means nothing has been authorised and nothing can be: a
	// wallet-only deployment, or any step before sign-in.
	if (!owner || !signer) return HIDDEN;

	const authorised = isRegistered(delegation, signer);

	return {
		visible: true,
		authorised,
		status: authorised
			? 'This browser can post greetings in your name.'
			: delegation.step === 'Loaded'
				? 'This browser cannot yet post in your name.'
				: 'Checking whether this browser can post in your name...',
		// Only an authorisation that exists can be withdrawn, and only by an
		// account that can send: `revokeDelegate` takes `msg.sender` as the
		// account withdrawing, so there is nobody else who could send it.
		canRevoke: authorised && ownerCanSend,
		revokeBlockedReason:
			!authorised || ownerCanSend
				? undefined
				: 'This account has no wallet, so it cannot send the transaction that withdraws access.',
	};
}

export type DelegationRowStore = Readable<DelegationRowView>;

/** Bind the view above to the app's stores. */
export function createDelegationRowStore(
	params: Pick<Context, 'connection' | 'delegation' | 'accountExecutor'>,
): DelegationRowStore {
	const {connection, delegation, accountExecutor} = params;

	return derived(
		[connection, delegation, accountExecutor],
		([$connection, $delegation, $executor]) => {
			const account = delegationAccountOf(
				$connection as Connection<UnderlyingEthereumProvider>,
			);
			return deriveDelegationRow({
				owner: account?.owner,
				signer: account?.delegate,
				delegation: $delegation,
				ownerCanSend: $executor.status === 'ready',
			});
		},
	);
}
