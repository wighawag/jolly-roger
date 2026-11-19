import {derived, type Readable} from 'svelte/store';
import type {Connection, UnderlyingEthereumProvider} from '@etherplay/connect';
import {isRegistered, type DelegationValue} from '$lib/onchain/delegation';
import type {Context} from '$lib/context/types';
import {grantStatus, type SignerGrant} from './grant';

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
	/**
	 * What the key is for, in this app's terms.
	 *
	 * The status lines below said "post greetings" until this arrived, which was
	 * the greeting demo's copy sitting in shared code and inherited, unread, by
	 * every app on the tree. Same fix as the payment dialog's consent list, and
	 * the same single source: see ./grant.
	 */
	grant: SignerGrant;
}): DelegationRowView {
	const {owner, signer, delegation, ownerCanSend, grant} = input;

	// No signer means nothing has been authorised and nothing can be: a
	// wallet-only deployment, or any step before sign-in. It is also what makes
	// the read below meaningful: the chain was asked about THIS signer, so the
	// answer is a field rather than an address to compare.
	if (!owner || !signer) return HIDDEN;

	const authorised = isRegistered(delegation);

	return {
		visible: true,
		authorised,
		status: grantStatus(
			grant,
			authorised
				? 'authorised'
				: delegation.step === 'Loaded'
					? 'not-authorised'
					: 'checking',
		),
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
	params: Pick<
		Context,
		'connection' | 'delegation' | 'accountExecutor' | 'signerGrant'
	>,
): DelegationRowStore {
	const {connection, delegation, accountExecutor, signerGrant} = params;

	return derived(
		[connection, delegation, accountExecutor],
		([$connection, $delegation, $executor]) => {
			// The account and its signer, read straight off the connection: this row
			// says whether THIS browser may act, which needs no credential and no
			// contract, only the two addresses and what the chain answered.
			const signedIn = $connection as Connection<UnderlyingEthereumProvider>;
			const account =
				signedIn.step === 'SignedIn' ? signedIn.account : undefined;
			return deriveDelegationRow({
				owner: account?.address,
				signer: account?.signer.address,
				delegation: $delegation,
				ownerCanSend: $executor.status === 'ready',
				grant: signerGrant,
			});
		},
	);
}
