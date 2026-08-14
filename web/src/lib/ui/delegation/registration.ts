import {findSavedDelegation} from '@etherplay/connect';
import type {PermissionOutcome, SavedDelegation} from '@etherplay/connect';

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

/** The (chain, contract) pair a credential is bound to, and nothing else. */
export type DelegationTarget = {
	chainId: number;
	contract: `0x${string}`;
};

/**
 * A credential, as the app carries it around: the owner's signature and the
 * deadline that was signed WITH it.
 *
 * One type rather than two arguments travelling side by side, because they are
 * only meaningful together: the deadline is inside the signed bytes and the
 * contract cannot know it any other way, so a signature that gets separated
 * from its deadline is a signature that cannot be submitted. Same reasoning as
 * {@link DelegationTarget}, which is the other half of what a signature says.
 */
export type DelegationCredential = {
	signature: `0x${string}`;
	/** unix seconds; 0 means no expiry */
	deadline: number;
};

/**
 * How long before a deadline a stored credential is treated as spent.
 *
 * The check is against the BROWSER's clock, which is neither the chain's nor
 * accurate, and between reading it and the transaction being mined there is a
 * wallet prompt, a network and a block. So the margin is not precision, it is
 * the difference between "this will not work" said here and a `SignatureExpired`
 * revert said after the user has paid for the gas.
 *
 * The revert remains the real backstop: a browser clock that is minutes out
 * cannot be corrected from here, and the only party that decides is the
 * contract. See how a rejected credential is handled in ./register-delegate.
 */
export const EXPIRY_MARGIN_SECONDS = 120;

/**
 * Whether a credential is too close to its deadline to be worth submitting.
 *
 * Zero is not a deadline, it is the absence of one, and treating a falsy value
 * as absent is precisely the bug the vectors in @etherplay/delegation pin
 * against (the smallest non-zero deadline, one second past the epoch, is long
 * expired and must NOT read as "never expires").
 */
export function credentialExpired(
	deadline: number,
	now: number = Date.now(),
): boolean {
	if (deadline === 0) return false;
	return deadline - EXPIRY_MARGIN_SECONDS <= Math.floor(now / 1000);
}

/**
 * What the connection has to offer for ONE (chainId, contract) pair.
 *
 * An ANSWER for every case, including the absences, because the app cannot
 * offer the right remedy without knowing WHY it has nothing: "you declined" and
 * "nobody asked" call for different sentences, and a missing credential says
 * neither. That is what `account.permissions` is for.
 */
export type CredentialState =
	/** A credential this browser can submit right now. */
	| {kind: 'held'; credential: DelegationCredential}
	/**
	 * One exists and cannot be used: past its deadline, made for a delegate that
	 * is not this browser's signer, or already refused by the contract. All three
	 * are the same situation - a stored credential that will not do what it is
	 * there for - and they take the same remedy.
	 */
	| {kind: 'stale'}
	/** A human said no to this pair at sign-in. */
	| {kind: 'denied'}
	/** The wallet did not understand the request, so nobody was asked. */
	| {kind: 'unsupported'}
	/** Nothing was asked for this pair, so nothing was ever minted. */
	| {kind: 'none'};

/**
 * Pick the credential for one pair out of what the connection carries.
 *
 * `findSavedDelegation` comes from the library rather than being written again
 * here: the comparison (exact chain, case-insensitive contract) is the same one
 * the host used when it minted the record.
 */
export function credentialState(params: {
	savedDelegations: SavedDelegation[] | undefined;
	/** The outcome of every permission the app asked for, when it asked. */
	permissions: PermissionOutcome[] | undefined;
	target: DelegationTarget;
	/** This browser's signer, which is who the credential has to be for. */
	delegate: `0x${string}` | undefined;
	/**
	 * Signatures the contract has already refused, this session.
	 *
	 * The app cannot delete a record the wallet owns, so this is how a refusal
	 * STICKS: without it, backing out of the remedy and reopening the flow picks
	 * the same doomed credential again, and "self-healing" would mean "healing if
	 * the user does as they are told". See how it is filled in ../credits/top-up-flow.
	 */
	refused?: ReadonlySet<`0x${string}`>;
	now?: number;
}): CredentialState {
	const {target, delegate} = params;

	const saved = findSavedDelegation(params.savedDelegations, target);
	if (saved) {
		// EVERY FIELD ON THE RECORD IS ALSO INSIDE THE SIGNATURE, so these are
		// checks of a cache against what we know, never checks of the signature
		// itself - a stored copy disagreeing with the signed copy cannot be
		// detected locally at all. See ./register-delegate for what happens when
		// the contract is the one to notice.
		if (!sameAddress(saved.delegate, delegate)) return {kind: 'stale'};
		if (credentialExpired(saved.deadline, params.now)) return {kind: 'stale'};
		if (params.refused?.has(saved.signature)) return {kind: 'stale'};
		return {
			kind: 'held',
			credential: {signature: saved.signature, deadline: saved.deadline},
		};
	}

	const outcome = (params.permissions || []).find(
		(entry) =>
			entry.request.type === 'delegation' &&
			entry.request.chainId === target.chainId &&
			sameAddress(entry.request.contract, target.contract),
	);

	if (outcome && !outcome.granted) {
		return outcome.reason === 'unsupported'
			? {kind: 'unsupported'}
			: {kind: 'denied'};
	}

	// Including the impossible-looking case of an outcome that says GRANTED with
	// no record to show for it. There is nothing to submit either way, and the
	// remedy is the same as for a pair nobody asked about.
	return {kind: 'none'};
}

export type RegistrationRoute =
	/**
	 * The owner sends `registerDelegate` itself. No signature exists and none is
	 * needed: sending the transaction IS the proof.
	 */
	| {kind: 'direct'}
	/**
	 * The connection already carries the owner's credential for this contract.
	 * Nothing to prompt.
	 */
	| {kind: 'pre-signed'; credential: DelegationCredential}
	/** The owner's wallet is present and can be asked to sign now. */
	| {kind: 'live-signature'}
	/**
	 * The credential this browser would have used is missing or spent, and the
	 * only way to get another is to sign in again.
	 *
	 * ONE route with three reasons, not three routes: the remedy is identical
	 * (sign in again, which is where credentials are minted), while the sentence
	 * is not. `not-requested` is a MISCONFIGURATION of the app - it never asked
	 * this wallet for this contract - and should say so rather than blaming the
	 * user for something they did not do.
	 */
	| {kind: 're-authorise'; reason: 'denied' | 'expired' | 'not-requested'}
	/** Nothing the user does from here can work. */
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
	 * What the connection holds for THIS contract on THIS chain, and why it holds
	 * nothing when it holds nothing.
	 *
	 * An account whose key lives at a wallet host has no live arbitrary-signing
	 * capability, so sign-in is the only moment it could ever produce one; an
	 * account that is a wallet can be asked at any time and so has none saved.
	 * Reading the capability off the value avoids naming either mechanism here.
	 */
	credential: CredentialState;
	/** Whether the owner's wallet is on hand to sign a message right now. */
	ownerCanSignLive: boolean;
	/**
	 * Whether the owner has withdrawn its authorisation for this signer.
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
	const {owner, payer, ownerCanSend, credential, ownerCanSignLive} = input;

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

	if (credential.kind === 'held') {
		return {kind: 'pre-signed', credential: credential.credential};
	}

	// BEFORE the re-authorise routes: an owner that can be asked to sign has no
	// reason to sign in again, whatever the stored credential says.
	if (ownerCanSignLive) {
		return {kind: 'live-signature'};
	}

	if (credential.kind === 'unsupported') {
		// Signing in again cannot help: the wallet refused because it cannot
		// describe what was asked for, which is a version gap between the app and
		// the wallet rather than anything the user decided.
		return {
			kind: 'unavailable',
			reason:
				'Your wallet does not understand the permission this app asked for, so it cannot authorise this browser.',
		};
	}

	return {
		kind: 're-authorise',
		reason:
			credential.kind === 'denied'
				? 'denied'
				: credential.kind === 'stale'
					? 'expired'
					: 'not-requested',
	};
}

/**
 * What to say about a re-authorisation, per reason.
 *
 * The remedy is one sentence for all three and the cause is three different
 * ones, so the words live next to the routing that decides them rather than
 * being spread across the components that render them.
 */
export function reauthoriseExplanation(
	reason: Extract<RegistrationRoute, {kind: 're-authorise'}>['reason'],
): string {
	switch (reason) {
		case 'denied':
			return 'You declined to let this browser act for you when you signed in. Sign in again to allow it.';
		case 'expired':
			// Worded for every way a stored credential stops being usable, not for
			// the deadline alone: it may have lapsed, it may have been refused by
			// the contract, or it may have been minted for a different signer than
			// the one this browser now holds. The user can act on none of that, and
			// the remedy is the same for all three.
			return 'The authorisation this browser was going to use is no longer good, so it has to be granted again. Sign in again to renew it.';
		case 'not-requested':
			// A misconfiguration, and named as one: the user did nothing wrong and
			// signing in again only helps once the app asks for the right pair.
			return 'This app did not ask your account for permission at this contract, so there is nothing to submit. Signing in again is worth a try, and if it keeps happening it is the app that needs fixing.';
	}
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
	delegate: `0x${string}`;
	value: bigint;
	/**
	 * Present for the two signature routes, absent for the direct one.
	 *
	 * The deadline travels WITH the signature because it is inside the signed
	 * bytes and the contract cannot know it otherwise - unlike the contract and
	 * the chain, which it reads off `address(this)` and `block.chainid` and
	 * which are therefore never caller-supplied.
	 */
	credential?: DelegationCredential;
}): RegistrationRequest {
	const {owner, delegate, value, credential} = params;

	if (!delegate || /^0x0+$/.test(delegate)) {
		throw new Error('Cannot register the zero address as a delegate');
	}

	if (credential) {
		// The signature variant forces the payee to the delegate itself, so there
		// is nothing to pass: the money comes from a third party, who has no
		// business choosing a destination the owner never named.
		return {
			functionName: 'registerDelegateViaSignature',
			args: [
				owner,
				delegate,
				BigInt(credential.deadline),
				credential.signature,
			],
			value,
		};
	}

	return {
		functionName: 'registerDelegate',
		args: [delegate, delegate],
		value,
	};
}
