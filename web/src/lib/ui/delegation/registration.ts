import {originDelegationMessage} from '@etherplay/connect';

/**
 * Registering this browser's signer as a delegate of the account.
 *
 * The registry attributes a greeting to whoever the sender is acting for, and
 * it only accepts that claim from an address the account has authorised. So
 * before the app can post in the user's name, one transaction has to say so.
 *
 * The whole decision is TWO questions, and deliberately not "what kind of
 * account is this":
 *
 *  1. WHO PAYS - the account itself, or another wallet (see ./../credits/payment-methods).
 *  2. HOW IS THE AUTHORISATION PROVEN - by the owner sending the transaction
 *     (nothing to sign), or by a signature, which is either already in hand or
 *     asked for live.
 *
 * Branching on the account type instead would encode an assumption about which
 * mechanisms can pre-sign, and that assumption belongs to the connect library,
 * not here. Asking whether the signature IS there is the same question with no
 * assumption in it.
 */

/** Case-insensitive address comparison; the chain does not care about casing. */
export function sameAddress(
	a: `0x${string}` | undefined,
	b: `0x${string}` | undefined,
): boolean {
	if (!a || !b) return false;
	return a.toLowerCase() === b.toLowerCase();
}

export type RegistrationRoute =
	/**
	 * The owner sends `registerDelegate` itself. No signature exists and none is
	 * needed: sending the transaction IS the proof.
	 */
	| {kind: 'direct'}
	/** The connection already carries the owner's signature. Nothing to prompt. */
	| {kind: 'pre-signed'; signature: `0x${string}`}
	/** The owner's wallet is present and can be asked to sign now. */
	| {kind: 'live-signature'}
	/** Nothing can prove the authorisation from where the user is standing. */
	| {kind: 'unavailable'; reason: string};

export type RouteInput = {
	/** The authenticated account the greeting should belong to. */
	owner: `0x${string}` | undefined;
	/** The address that will send (and pay for) the registration transaction. */
	payer: `0x${string}` | undefined;
	/**
	 * Whether the owner can submit a transaction at all.
	 *
	 * Checked alongside the address match rather than instead of it: an account
	 * with no wallet cannot send, so it can never take the direct route even if
	 * something else were paying from the same address.
	 */
	ownerCanSend: boolean;
	/**
	 * The owner's signature over {@link originDelegationMessage}, when the
	 * connection carries one.
	 *
	 * PRESENCE is the test. An account whose key lives at a wallet host has no
	 * live arbitrary-signing capability, so sign-in is the only moment it could
	 * ever produce this; an account that is a wallet can be asked at any time and
	 * so has none saved. Reading the capability off the value avoids naming
	 * either mechanism here.
	 */
	savedSignature: `0x${string}` | undefined;
	/** Whether the owner's wallet is on hand to sign a message right now. */
	ownerCanSignLive: boolean;
	/**
	 * Whether the owner has withdrawn its authorisation for this signer
	 * (`delegationWithdrawn`).
	 *
	 * One-way as far as signatures go for THIS delegate: only an owner-sent
	 * `registerDelegate` clears it, precisely so an old signature (which
	 * carries no nonce) cannot undo a revocation. A DIFFERENT delegate can still
	 * be authorised by a fresh signature, so this rules out the signature routes
	 * only for the signer that was withdrawn.
	 */
	withdrawn: boolean;
};

/**
 * Which proof this situation can produce.
 *
 * Order matters. The direct route comes first because it COLLAPSES the
 * redundant case: nothing stops the user pointing the payment rail at the same
 * wallet and account they are signed in as, and asking someone to sign a
 * message authorising a key and then to send a transaction from that very
 * account is asking twice for one decision.
 */
export function chooseRegistrationRoute(input: RouteInput): RegistrationRoute {
	const {owner, payer, ownerCanSend, savedSignature, ownerCanSignLive} = input;

	if (!owner) {
		return {kind: 'unavailable', reason: 'No account is signed in.'};
	}

	if (ownerCanSend && sameAddress(owner, payer)) {
		return {kind: 'direct'};
	}

	if (input.withdrawn) {
		return {
			kind: 'unavailable',
			reason:
				"You withdrew this browser's access before. Re-authorising has to come from your own account, so pay from it rather than from another wallet.",
		};
	}

	if (savedSignature) {
		return {kind: 'pre-signed', signature: savedSignature};
	}

	if (ownerCanSignLive) {
		return {kind: 'live-signature'};
	}

	return {
		kind: 'unavailable',
		reason:
			'This account cannot send a transaction and cannot sign a message, so there is no way to prove the authorisation.',
	};
}

/**
 * The exact text the owner signs, built by the library that the contract is
 * pinned against.
 *
 * ALWAYS through this. The wording and the address casing are consensus between
 * `Delegation.message` in Solidity and `originDelegationMessage` here (there is
 * a test pinning the two together); hand-rolling the string, or checksumming
 * the address the builder lowercases, produces a signature the contract
 * rejects with no clue as to why.
 */
export function delegationMessage(
	origin: string,
	delegate: `0x${string}`,
): string {
	return originDelegationMessage(origin, delegate);
}

export type RegistrationRequest = {
	functionName: 'registerDelegate' | 'registerDelegateViaSignature';
	args: readonly unknown[];
	value: bigint;
};

/**
 * The contract call that registers `delegate`, and funds it in the same
 * transaction.
 *
 * ONE transaction, not two, and that is the point of the `payee` parameter: a
 * freshly derived signer holds nothing, and an address that cannot pay for gas
 * cannot do the thing it was just authorised to do. So the first top-up IS the
 * registration.
 *
 * The signature decides the entry point, because the two say different things.
 * Without one, the owner is sending, and sending is the proof; with one, anyone
 * may submit and the owner's say-so travels in the signature.
 *
 * The payee is always the delegate, never the zero address: `Payments.forward`
 * REVERTS on value with a zero payee rather than quietly keeping it.
 */
export function registrationRequest(params: {
	owner: `0x${string}`;
	/**
	 * The scope the authorisation is granted for. Must be BYTE-IDENTICAL to what
	 * was signed, so it is the signer's own origin rather than anything derived
	 * again here.
	 */
	origin: string;
	delegate: `0x${string}`;
	value: bigint;
	/** Present for the two signature routes, absent for the direct one. */
	signature?: `0x${string}`;
}): RegistrationRequest {
	const {owner, origin, delegate, value, signature} = params;

	if (!delegate || /^0x0+$/.test(delegate)) {
		throw new Error('Cannot register the zero address as a delegate');
	}

	if (signature) {
		// The signature variant forces the payee to the delegate itself, so there
		// is nothing to pass: the money comes from a third party, who has no
		// business choosing a destination the owner never named.
		return {
			functionName: 'registerDelegateViaSignature',
			args: [owner, origin, delegate, signature],
			value,
		};
	}

	return {
		functionName: 'registerDelegate',
		args: [delegate, delegate],
		value,
	};
}
