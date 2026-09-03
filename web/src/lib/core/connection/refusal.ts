import {
	ConnectionFailure,
	type ConnectionFailureReason,
	type PermissionOutcome,
} from '@etherplay/connect';

/**
 * Why a connection attempt came back with nothing, in THIS APP's terms.
 *
 * READ OFF `reason`, NOT GUESSED AT. @etherplay/connect 0.13.0 says why a
 * failure happened in a closed vocabulary it controls, on both the thrown
 * `ConnectionFailure` and the resting `connection.error`, and it copies one to
 * the other so the banner and the caught error cannot tell different stories.
 * Before that this module inferred intent: it matched the host's refusal shapes
 * on `cause.type`, and decided "the user cancelled" from the ABSENCE of a
 * `cause`. That was the best available signal and it was wrong at the edges, by
 * its own admission: `could not get any accounts` carries no cause and so read
 * as a cancellation, and once 0.12.0 started answering honestly instead of
 * hanging, its `unreachable` and `superseded` answers arrived carrying no cause
 * either and were silently rendered as "the user chose not to".
 *
 * So `kind` IS the library's `reason`, unchanged. This module no longer decides
 * what happened; it decides what to SAY about it, which is the part that is
 * genuinely this app's.
 *
 * The structured extras are still read from `cause`, because they are the wallet
 * HOST's payload rather than the library's: posted across an origin boundary,
 * arriving as plain JSON, and typed by nobody. `reason` says which shape to
 * expect, so they are no longer used to work out what happened.
 */
export type ConnectionRefusal = {
	kind: ConnectionFailureReason;
	/** The host's own words, for the reasons where they are the best available. */
	message: string;
	/**
	 * Which declared permissions the host answered for, when it refused a
	 * required one. Empty for every other reason.
	 */
	permissions: PermissionOutcome[];
	/** The page that asked, when a cross-origin request was blocked. */
	windowOrigin: string;
	/** The origin whose account it asked for, when that was blocked. */
	signingOrigin: string;
};

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
 * Build this app's view of a failure from the library's `reason` plus whatever
 * structured payload the host attached.
 *
 * ONE CLASSIFIER FOR BOTH SURFACES, because it is one vocabulary: the resting
 * `connection.error` and the thrown `ConnectionFailure` carry the same `reason`
 * for the same event, so telling them apart twice would be two chances to
 * disagree.
 */
function classify(
	reason: ConnectionFailureReason,
	cause: unknown,
	message: string,
): ConnectionRefusal {
	const refusal = asHostRefusal(cause);
	return {
		kind: reason,
		message: textOrEmpty(refusal?.message) || message,
		permissions: Array.isArray(refusal?.permissions)
			? (refusal.permissions as PermissionOutcome[])
			: [],
		windowOrigin: textOrEmpty(refusal?.windowOrigin),
		signingOrigin: textOrEmpty(refusal?.signingOrigin),
	};
}

/**
 * Whether the user DECIDED this, as opposed to something going wrong.
 *
 * Two reasons mean it, and they are told apart by `reason` rather than by
 * shape: an acknowledged `addressUnavailable` deliberately still carries
 * `message: 'Connection cancelled'` so that no surface paints a red error over
 * a decision. Both are answered with silence, which is why this predicate
 * exists rather than each call site listing the members: adding a third
 * decision must not require finding every `if` that means "they chose not to".
 *
 * EVERYTHING ELSE IS REPORTABLE, including the reasons that used to look like
 * this one. `unreachable` in particular is an outcome the library went to some
 * trouble to produce instead of hanging, and swallowing it turns that back into
 * silence.
 */
export function isUserDecision(refusal: ConnectionRefusal): boolean {
	return (
		refusal.kind === 'cancelled' ||
		refusal.kind === 'address-unavailable-acknowledged'
	);
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
	return classify(error.reason, error.cause, error.message);
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
	error:
		| {message: string; cause?: unknown; reason: ConnectionFailureReason}
		| undefined,
): ConnectionRefusal | undefined {
	if (!error) return undefined;
	return classify(error.reason, error.cause, error.message);
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
		case 'host-refused':
			// The HOST picks its own vocabulary and the library passes it through
			// rather than claiming to understand it, so the payload is what says
			// which refusal this is. A required permission declined is the one this
			// app has words for; anything else keeps the host's own.
			return refusal.permissions.length
				? 'You declined a permission this app cannot work without, so you are not signed in. Sign in again and allow it if you want to carry on.'
				: refusal.message;
		case 'cross-origin-blocked':
			// Named as somebody else's mistake, deliberately: the user did nothing
			// wrong and can do nothing about it, and a message implying otherwise
			// sends them round a loop looking for the setting that would fix it.
			return refusal.signingOrigin
				? `This site is not allowed to ask for the account held by ${refusal.signingOrigin}, and trying again will not change that. It is the app's configuration that needs fixing, not anything you did.`
				: "This site is not allowed to ask for the account it tried to use, and trying again will not change that. It is the app's configuration that needs fixing, not anything you did.";
		case 'cancelled':
		case 'address-unavailable-acknowledged':
			return 'You are not signed in.';
		case 'wallet-rejected':
			return 'Your wallet declined the request. Try again if you meant to allow it.';
		case 'wallet-unavailable':
			// Retrying cannot help: the wallet is refusing to authorise accounts at
			// all, so the remedy is in the wallet rather than in this page.
			return 'Your wallet would not authorise an account. Unlock it, or check which sites it is allowed to talk to, then try again.';
		case 'no-accounts':
			// Looks like a refusal and is not one, which is why it gets its own
			// sentence rather than "you are not signed in": nobody declined
			// anything, the wallet simply has no account to offer.
			return 'Your wallet did not offer any account. Create or import one in your wallet, then try again.';
		case 'superseded':
			return 'Another account was requested before this one finished. Try again.';
		case 'unreachable':
			// The outcome 0.12.0 added rather than hanging. Reporting it is the
			// entire point; swallowing it turns the fix back into silence.
			return 'The connection could not get there, and nothing is in progress. Try again.';
		default:
			// NEW MEMBERS ARRIVE IN MINOR VERSIONS, which the library states plainly
			// and accepts as the price of a union the compiler can exhaust. Falling
			// back to the library's own words is always safe; falling through to
			// "you are not signed in" would invent a diagnosis.
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
	error:
		| {message: string; cause?: unknown; reason: ConnectionFailureReason}
		| undefined,
): ConnectionFailureView | undefined {
	const refusal = restingRefusal(error);
	if (!refusal) return undefined;

	if (refusal.kind === 'cross-origin-blocked') {
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
	}
	if (refusal.kind === 'host-refused' && refusal.permissions.length) {
		return {title: 'Not signed in', message: refusalExplanation(refusal)};
	}
	return {title: 'Connection Failed', message: refusalExplanation(refusal)};
}
