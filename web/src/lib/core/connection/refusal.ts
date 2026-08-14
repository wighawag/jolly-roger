import {ConnectionFailure, type PermissionOutcome} from '@etherplay/connect';

/**
 * Why a connection attempt came back with nothing.
 *
 * A REFUSAL IS NOT A CANCELLATION, and until @etherplay/connect 0.6.0 the app
 * could not tell: everything coming back from the wallet popup was flattened on
 * the way to `Idle`, so `connection.error` stayed unset and `ensureConnected`
 * rejected with a generic `ConnectionFailure('Connection cancelled')` whatever
 * had happened. Now the host's own reason travels with it, and the remedies are
 * genuinely different - one is a prompt to answer differently, one cannot
 * succeed however many times it is tried - so they are told apart here, once,
 * and every surface reads the answer rather than the object.
 *
 * The two refusal shapes are the HOST's, not this library's, which is why they
 * are matched structurally on `type` rather than by class: they are posted
 * across an origin boundary and arrive as plain JSON.
 */
export type ConnectionRefusal =
	/**
	 * A permission the app declared `required` was declined, so the host refused
	 * to hand the account over at all.
	 *
	 * Only ever reachable for a REQUIRED entry: the host reports an optional
	 * refusal as a `granted: false` outcome on an account it still delivers (see
	 * ui/delegation/registration), and sign-in succeeds. This app declares its
	 * one permission optional, so this arrives only in a descendant that chose
	 * otherwise.
	 */
	| {kind: 'permission-denied'; permissions: PermissionOutcome[]}
	/**
	 * The page asked for the account of an origin that is not its own, and the
	 * wallet host did not consent to that pairing.
	 *
	 * NOTHING THE USER OR THE APP CAN DO FROM HERE, which is what makes it worth
	 * its own kind: the consent lives in the host's allowlist, so a retry cannot
	 * succeed and a retry button would be a lie. It only arises for an app that
	 * passes a `signingOrigin` pointing elsewhere; this one passes none, so the
	 * host resolves it as same-origin and never reaches the decision.
	 */
	| {
			kind: 'cross-origin-blocked';
			/** The page that asked. */
			windowOrigin: string;
			/** The origin whose account it asked for. */
			signingOrigin: string;
	  }
	/** The user backed out: closed the popup, or cancelled the flow. */
	| {kind: 'cancelled'}
	/** Something else failed, and its own words are the best available. */
	| {kind: 'other'; message: string};

/** A refusal object as the wallet host posts it, before anything is known about it. */
type HostRefusal = {
	type?: unknown;
	message?: unknown;
	permissions?: unknown;
	windowOrigin?: unknown;
	signingOrigin?: unknown;
};

function asHostRefusal(cause: unknown): HostRefusal | undefined {
	return typeof cause === 'object' && cause !== null
		? (cause as HostRefusal)
		: undefined;
}

function textOrEmpty(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * Read the reason out of whatever a failed attempt left behind.
 *
 * ONE CLASSIFIER FOR BOTH SURFACES, because it is literally one object: the
 * library sets `connection.error = {message, cause}` at the moment it falls
 * back to a resting step, and `ensureConnected` rejects with
 * `new ConnectionFailure(error.message, error.cause)`. So the `cause` a
 * component reads off the store and the `cause` a call site catches are the
 * same value, and telling them apart twice would be two chances to disagree.
 *
 * A `cause` this app does not recognise is `other`, carrying the host's own
 * words, and NEVER `cancelled`: a reason we cannot interpret is no evidence
 * that anybody backed out of anything, and silence is the one response that
 * cannot be corrected later.
 */
function classify(cause: unknown, message: string): ConnectionRefusal {
	const refusal = asHostRefusal(cause);

	if (refusal?.type === 'permission-denied') {
		return {
			kind: 'permission-denied',
			// Whatever the host answered for, in the order it was asked. Not
			// currently rendered - the sentence below does not depend on which
			// entry it was - but carried rather than dropped, so a descendant with
			// several declared permissions can name the one that blocked it.
			permissions: Array.isArray(refusal.permissions)
				? (refusal.permissions as PermissionOutcome[])
				: [],
		};
	}

	if (refusal?.type === 'cross-origin-blocked') {
		return {
			kind: 'cross-origin-blocked',
			windowOrigin: textOrEmpty(refusal.windowOrigin),
			signingOrigin: textOrEmpty(refusal.signingOrigin),
		};
	}

	// NO UNDERLYING ERROR MEANS NOBODY FAILED. Every failure path in the library
	// attaches the thing that went wrong; the cancellation paths have nothing to
	// attach, because closing a popup is an answer rather than a fault. That is
	// the whole of the distinction, and it is read off the absence rather than
	// off the wording, which would break the moment upstream rephrased it.
	//
	// One library failure shares the shape (`could not get any accounts`, which
	// sets a message and no cause) and so reads as a cancellation here. The
	// mistake is in the harmless direction: it costs the details link, and every
	// surface below answers it with "sign in again", which is the right advice
	// for it anyway.
	if (cause === undefined || cause === null) {
		return {kind: 'cancelled'};
	}

	return {kind: 'other', message: textOrEmpty(refusal?.message) || message};
}

/**
 * Why `ensureConnected` rejected, or `undefined` when the error came from
 * somewhere else entirely.
 *
 * Undefined rather than an `other` refusal for a foreign error, because callers
 * wrap much more than the connect call in one `try`: a balance check and a
 * `writeContract` throw through the same catch, and treating those as
 * connection failures would silence real transaction errors.
 */
export function connectionRefusal(
	error: unknown,
): ConnectionRefusal | undefined {
	if (!(error instanceof ConnectionFailure)) return undefined;
	return classify(error.cause, error.message);
}

/**
 * Why the connection is resting with an error on it.
 *
 * Separate entry point from {@link connectionRefusal} rather than one function
 * sniffing at its argument: `connection.error` is a plain `{message, cause}`
 * record and an `Error` also has a `message`, so a single function accepting
 * both would classify every thrown error in the app as a connection refusal.
 */
export function restingRefusal(
	error: {message: string; cause?: unknown} | undefined,
): ConnectionRefusal | undefined {
	if (!error) return undefined;
	return classify(error.cause, error.message);
}

/**
 * What the app says about each reason, in its own words.
 *
 * HERE rather than in the components, for the reason `reauthoriseExplanation`
 * lives next to the routing that decides it: the sentence and the decision that
 * picks it belong together, and the same two sentences are needed by the
 * connection's own modal and by the top-up flow's sign-in step.
 *
 * NEITHER SENTENCE INVITES A RETRY. A blocked origin cannot succeed on a second
 * attempt, since the consent that would allow it lives in the wallet host and
 * not in anything this page can reach; a declined required permission needs the
 * person to answer differently, which is a decision, not something to ask again
 * in a loop. The host's own message is a diagnosis for whoever configured the
 * app ("<a> may not request an account for <b>"), so it is not repeated at the
 * user, only carried as the quieter second line.
 */
export function refusalExplanation(refusal: ConnectionRefusal): string {
	switch (refusal.kind) {
		case 'permission-denied':
			return 'You declined a permission this app cannot work without, so you are not signed in. Sign in again and allow it if you want to carry on.';
		case 'cross-origin-blocked':
			// Named as somebody else's mistake, deliberately: the user did nothing
			// wrong and can do nothing about it, and a message implying otherwise
			// sends them round a loop looking for the setting that would fix it.
			return refusal.signingOrigin
				? `This site is not allowed to ask for the account held by ${refusal.signingOrigin}, and trying again will not change that. It is the app's configuration that needs fixing, not anything you did.`
				: "This site is not allowed to ask for the account it tried to use, and trying again will not change that. It is the app's configuration that needs fixing, not anything you did.";
		case 'cancelled':
			return 'You are not signed in.';
		case 'other':
			return refusal.message;
	}
}

/** Title, sentence and diagnosis for the connection's own failure modal. */
export type ConnectionFailureView = {
	title: string;
	message: string;
	/**
	 * A quieter second line, present only where the useful detail is addressed to
	 * whoever configured the app rather than to the person reading it.
	 */
	detail?: string;
};

/**
 * What the connection's failure modal should say, or `undefined` when there is
 * nothing resting on the connection to report.
 *
 * The modal used to print `connection.error.message` raw, which was tolerable
 * while every message came from a wallet and described a wallet problem. Under
 * 0.6.0 it also carries the wallet host's refusals, whose messages are written
 * for a developer reading a console, so they are answered here instead.
 */
export function connectionFailureView(
	error: {message: string; cause?: unknown} | undefined,
): ConnectionFailureView | undefined {
	const refusal = restingRefusal(error);
	if (!refusal) return undefined;

	switch (refusal.kind) {
		case 'permission-denied':
			return {title: 'Not signed in', message: refusalExplanation(refusal)};
		case 'cross-origin-blocked':
			return {
				title: 'This site cannot use that account',
				message: refusalExplanation(refusal),
				// BOTH ORIGINS, side by side, which the library notes is the whole
				// diagnosis: an app landing here has almost always misconfigured
				// `signingOrigin`, and the two strings together say which way round.
				detail:
					refusal.windowOrigin && refusal.signingOrigin
						? `${refusal.windowOrigin} requesting ${refusal.signingOrigin}`
						: undefined,
			};
		case 'cancelled':
		case 'other':
			// Unchanged from before 0.6.0: a wallet's own words about a wallet's own
			// problem are better than anything this app could substitute for them.
			return {title: 'Connection Failed', message: error?.message ?? ''};
	}
}
