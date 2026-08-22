import {derived, get, readable, writable, type Readable} from 'svelte/store';
import {
	canDismissConnection,
	isBurnerWalletInSelectionPhase,
	type ConnectionStateSnapshot,
} from './connection-flow';

/**
 * WHAT THE WALLET IS HOLDING, and how the app lets the user out of it.
 *
 * ONE PLACE THAT RECONCILES THE SOURCES, which is the whole reason this module
 * exists. There are three, and they disagree by nature:
 *
 * - `wallet.pendingRequests`, the connection library's list, which is authoritative
 *   when it is populated and is reset to `[]` by a wallet state rebuild while the
 *   request is still outstanding. Unlocking a locked wallet is such a rebuild;
 *   a user's console log showed the list at 0 with a transaction genuinely in
 *   flight (work/notes/observations/wallet-action-required-modal-not-seen.md).
 * - `$inFlight.dispatching`, the app's OWN count of sends it has made and not had
 *   answered. It cannot go missing, but it starts a beat later than the library's
 *   and knows nothing about signature or connection requests.
 * - the requests the user has already given up on, which must stop a prompt
 *   reappearing without silencing the NEXT request.
 *
 * Every consumer used to combine those itself, and they drifted: the escape hatch
 * appeared on the strength of a dispatch, then the code behind it read only the
 * library's list, concluded nothing was outstanding, and cancelled the connection.
 * That is the disconnect-and-lose-the-transaction bug, reintroduced by the very
 * change that fixed the modal.
 *
 * So app code reads {@link createWalletActivity} and nothing else, and that is a
 * RULE rather than an intention: `test/wallet-activity-boundary.test.ts` fails
 * if any `src` file outside this one imports a primitive below. The primitives
 * stay exported because they are pure, carefully worded and worth testing one at
 * a time, but a claim nothing checks is a wish, which is what
 * `framework-boundary.test.ts` says about the rule next door. If the derived
 * value does not answer your question, add a field to it so that every consumer
 * gets the same answer.
 *
 * The action lives here too, deliberately. Whether the user is trapped and what
 * to do when they say so are the same decision, and splitting them is what let
 * them disagree.
 */

/**
 * Whether this step should offer the escape hatch.
 *
 * Defined AS the negation of {@link canDismissConnection}, not as its own list
 * of steps, and that is the point rather than a shortcut: the steps that refuse
 * dismissal are exactly the steps where a user can get stuck, so a step added
 * to that refusal later inherits an exit instead of quietly becoming a trap.
 * Two lists would drift, and the drift would be invisible until somebody was
 * stuck on a modal in production.
 */
export function offersEscapeHatch(
	state: ConnectionStateSnapshot,
	options?: {dispatchInFlight?: boolean},
): boolean {
	// A dispatch the app is still waiting on traps the user just as surely as a
	// step that refuses dismissal, and for the same reason: something is with the
	// wallet and only the wallet can end it. It has to carry an exit even when the
	// connection library has lost track of the request.
	if (options?.dispatchInFlight) return true;
	return !canDismissConnection(state);
}

/**
 * What the wallet is holding, when it is holding something.
 *
 * `transaction` is the dangerous one and gets different words: a signature the
 * user approves late is untidy, a transaction the user approves late MOVES
 * FUNDS, and the app has to say so before the user walks away from it.
 */
export function outstandingRequestKind(
	state: ConnectionStateSnapshot,
	options?: {dispatchInFlight?: boolean},
): 'transaction' | 'signature' | undefined {
	// THE APP'S OWN DISPATCH COUNTS, and outranks the list, because the list is
	// the thing that goes missing: a wallet state rebuild resets
	// `pendingRequests` to [] while the request is still outstanding, which is why
	// the modal and the escape hatch consult `dispatching` too. Everything that
	// asks "what is the wallet holding" has to ask it the same way, or the answer
	// drifts between the control that offers an exit and the code that takes it.
	// It did: the hatch appeared on the strength of a dispatch, and confirming it
	// then read an empty list, concluded nothing was outstanding, and cancelled
	// the connection, which is the disconnect-and-lose-the-transaction bug this
	// slice exists to prevent.
	//
	// A dispatch is by definition a transaction, so it answers with the kind that
	// gets the careful words and the careful branch.
	if (options?.dispatchInFlight) return 'transaction';

	const requests = state.wallet?.pendingRequests ?? [];
	let seen: 'transaction' | 'signature' | undefined;
	for (const request of requests) {
		const kind = (request as {kind?: unknown}).kind;
		// A transaction outranks a signature: with both outstanding, the sentence
		// has to be about the one that can spend money.
		if (kind === 'transaction') return 'transaction';
		if (kind === 'signature') seen = 'signature';
	}
	return seen;
}

/** The words of the escape hatch. See {@link escapeHatchCopy}. */
export type EscapeHatchCopy = {
	/** Label of the button that opens the confirmation, on the waiting modal. */
	trigger: string;
	title: string;
	/** The honest paragraph. */
	body: string;
	/** Label of the button that goes through with it. */
	confirm: string;
	/** Label of the button that goes back to waiting. */
	dismiss: string;
};

/**
 * The escape hatch's wording, decided here rather than in the component.
 *
 * THE WORDING IS THE FEATURE. This exists because the app cannot withdraw a
 * request the wallet already has, so the one thing it must never do is offer a
 * button that implies it can. "Cancel" implies exactly that, which is why the
 * label is `Stop waiting` and every sentence below says who still holds the
 * request. Kept in a `.ts` file so a review of what the app promises the user is
 * a review of one function, and so it can be tested.
 */
export function escapeHatchCopy(
	state: ConnectionStateSnapshot,
	options?: {dispatchInFlight?: boolean},
): EscapeHatchCopy {
	const kind = outstandingRequestKind(state, options);

	if (kind === 'transaction') {
		return {
			trigger: 'Stop waiting',
			title: 'Your wallet still has this transaction',
			body: 'This app cannot take a request back once your wallet has it. If you approve it later, it will still be sent, even though this app has stopped waiting. We have kept a note of it and will tell you what we can find out.',
			confirm: 'Stop waiting',
			dismiss: 'Keep waiting',
		};
	}

	if (kind === 'signature') {
		return {
			trigger: 'Stop waiting',
			title: 'Your wallet still has this signature request',
			body: 'This app cannot take a request back once your wallet has it. If you approve it later, the signature is still produced, and this app will simply not be waiting for it. Nothing is spent either way.',
			confirm: 'Stop waiting',
			dismiss: 'Keep waiting',
		};
	}

	return {
		trigger: 'Stop waiting',
		title: 'Stop waiting for your wallet?',
		body: 'This app cannot take a request back once your wallet has it. Your wallet may still show this request, and answering it later will still do what it says. Stopping here only means this app gives up waiting for the answer.',
		confirm: 'Stop waiting',
		dismiss: 'Keep waiting',
	};
}

/** Ids of the requests the wallet is holding right now. */
export function pendingRequestIds(state: ConnectionStateSnapshot): string[] {
	const requests = state.wallet?.pendingRequests ?? [];
	return requests
		.map((request) => (request as {id?: unknown}).id)
		.filter((id): id is string => typeof id === 'string');
}

/**
 * Whether to put the "confirm the request in your wallet" modal on screen.
 *
 * `hasPendingWalletRequest` (./connection-flow) asks whether the wallet is
 * holding something, which is a fact about the wallet. This asks whether to keep
 * BLOCKING THE USER
 * with it, which is a different question, because they are allowed to say no:
 * having taken the escape hatch, the request is still outstanding and the modal
 * should still be gone. Ids, not a flag, so stopping waiting on one request
 * cannot silently suppress the prompt for the next one.
 */
export function shouldPromptForWalletAction(
	state: ConnectionStateSnapshot,
	stoppedWaitingFor: ReadonlySet<string>,
	options?: {
		/**
		 * Whether the APP is still waiting on a dispatch of its own
		 * (`$inFlight.dispatching > 0`).
		 *
		 * A SECOND, more trustworthy source. `wallet.pendingRequests` is transient
		 * library state: a wallet state rebuild resets it to `[]` while the request
		 * is still outstanding, and unlocking a locked wallet is exactly such a
		 * rebuild. When that happened the modal never appeared, so the user was
		 * given no indication their wallet was waiting and, worse, no escape hatch.
		 *
		 * The app's own record does not have that problem: it is written
		 * immediately before dispatch and cleared only by an answer. Using both
		 * means the prompt survives the library losing track, and it also makes the
		 * prompt, the escape hatch and the unload guard agree, since all three now
		 * rest on this one fact.
		 */
		dispatchInFlight?: boolean;
	},
): boolean {
	// Still suppressed for the burner, which needs no human confirmation: a
	// prompt asking for one would be a lie, and its dispatch settles in
	// milliseconds so the app's own signal would only make the modal flash.
	if (isBurnerWalletInSelectionPhase(state)) return false;

	const requests = state.wallet?.pendingRequests ?? [];
	// A request with no id cannot be stopped-waiting-on individually, so it still
	// counts. Better to show a modal the user has already dismissed than to hide
	// one they have never seen.
	const outstanding = requests.some((request) => {
		const id = (request as {id?: unknown}).id;
		return typeof id !== 'string' || !stoppedWaitingFor.has(id);
	});

	// Stopping waiting clears the app's live dispatches too (see
	// `stopWaitingForWallet`), so this needs no separate suppression.
	return outstanding || options?.dispatchInFlight === true;
}

/** The half of the connection store the escape hatch needs. */
type CancellableConnection = {cancel: () => void};

/**
 * The in-flight ledger, as far as the escape hatch is concerned.
 * See `core/transaction/in-flight-store`.
 */
type ReconcilableLedger = {
	reconcile: () => Promise<void>;
	stopAwaiting: () => void;
};

/** What stopping waiting actually did, so callers and tests can tell. */
export type StopWaitingOutcome = 'released-prompt' | 'cancelled-connection';

/**
 * Stop waiting for the wallet, honestly. TWO DIFFERENT ACTS, chosen by what the
 * wallet is holding, and getting this wrong loses transactions.
 *
 * A TRANSACTION: release the prompt and change NOTHING ELSE. The user is
 * connected, and what they asked to stop waiting for is the request, not the
 * connection. `connection.cancel()` here would be a disaster dressed up as a
 * courtesy: it sets the flow to Idle, clears the wallet and calls
 * `deleteLastWallet()`, so the account goes away, and with it the account data
 * that `transaction:broadcasted` writes into. The user then approves in their
 * wallet, the transaction lands, and the app cannot record it. That is exactly
 * the data loss this whole slice exists to prevent, caused by the feature meant
 * to prevent it. Observed, reproduced, and now covered by a test.
 *
 * A CONNECTION OR SIGNATURE REQUEST: cancel the flow. There is no account yet
 * and no transaction to lose, and leaving the flow half-open would strand the
 * user on a modal with nothing behind it.
 *
 * The dispatched request is untouched either way, and the promise it rides is
 * left to settle on its own: if the user approves it later, the hash comes back,
 * the transaction is recorded like any other, and the in-flight record settles
 * itself. That is what makes the escape hatch's promise ("approving it later
 * still acts") true rather than a form of words.
 */
export async function stopWaitingForWallet(
	state: ConnectionStateSnapshot,
	connection: CancellableConnection,
	inFlight: ReconcilableLedger,
	releasePrompt: (requestIds: readonly string[]) => void,
	options?: {dispatchInFlight?: boolean},
): Promise<StopWaitingOutcome> {
	// RELEASE THE CALLER TOO, whichever branch follows. Dismissing the modal only
	// released the user from a dialog; whatever started the send is still awaiting
	// a promise the wallet is under no obligation to settle, and it is holding a
	// disabled, spinning button on the page behind. The dispatch itself keeps
	// running and still settles its record. See StoppedWaitingError.
	inFlight.stopAwaiting();

	// Judged from BOTH sources, exactly as the control that offered this exit was.
	// Asking a narrower question here than `offersEscapeHatch` asked is how the
	// disconnect bug came back.
	if (outstandingRequestKind(state, options) === 'transaction') {
		releasePrompt(pendingRequestIds(state));
		// Deliberately NOT reconciled here. The app has not stopped listening, it
		// has stopped blocking; the request is still live and will settle its own
		// record. Reconciling now would raise "we cannot tell whether this was
		// sent" about something we are still perfectly placed to find out.
		return 'released-prompt';
	}

	connection.cancel();
	// Here the app really has stopped listening, so it goes and finds out what it
	// can rather than leaving the question open.
	await inFlight.reconcile();
	return 'cancelled-connection';
}

/**
 * Which wallet requests the user has stopped waiting on.
 *
 * BY REQUEST ID, not a flag. Giving up on one request must not silence the
 * prompt for the next one: a user who abandons a stuck transaction and then
 * sends another still needs to be told to confirm THAT one, and a flag would
 * have made the second send silent, which is a worse bug than the one the escape
 * hatch fixes and would only appear on the second attempt.
 *
 * In memory on purpose. Ids belong to a provider instance and mean nothing after
 * a reload, and a reload is not a reason to re-block someone on a modal about a
 * request they already dismissed. What survives a reload is the in-flight
 * record, which is the thing that actually matters.
 */
function createStoppedWaiting() {
	const store = writable<ReadonlySet<string>>(new Set());
	return {
		subscribe: store.subscribe,
		/**
		 * REPLACES rather than adds, with the ids outstanding at this moment. The
		 * set only ever needs to describe requests the wallet is holding NOW, so
		 * rebuilding it keeps it from growing for the life of the tab and keeps an
		 * answered request's id out of the way of a later one.
		 */
		stopWaitingFor(requestIds: readonly string[]) {
			store.set(new Set(requestIds));
		},
	};
}

/**
 * One answer about the wallet, for the flow UI to render without deciding.
 *
 * Only what a consumer actually reads. There was a `holding: 'transaction' |
 * 'signature'` field here, carried because it names the module's subject so
 * neatly, and nothing outside the tests ever read it: the kind reaches the user
 * through `escapeCopy`, which is where the careful wording lives. A minimal
 * answer with a speculative field is no longer minimal, and this is the type the
 * boundary rule forces every consumer through, so it is the last place to keep
 * something on the grounds that it might be handy. Add a field when a consumer
 * needs one, which is cheaper than guessing which.
 */
export type WalletActivity = {
	/** Whether to keep blocking the user with "confirm the request in your wallet". */
	promptUser: boolean;
	/**
	 * Whether a stray click or an ESC should be allowed to tear the flow down.
	 *
	 * The FIFTH consumer, and it was left behind when the other four moved here.
	 * `canDismissConnection` reads the connection library's request list and
	 * nothing else, and the modals wire it straight to `connection.cancel()`, so
	 * in the one state this module exists for (the list emptied by a wallet state
	 * rebuild while a dispatch is outstanding) a click outside the Network Switch
	 * modal disconnected with a transaction in flight, bypassing `stopAwaiting()`
	 * and the stopped-waiting bookkeeping. The same bug as the escape hatch had,
	 * through a different door, and invisible to a rule that only watched imports
	 * of the primitives.
	 *
	 * It is the exact complement of {@link escapable}: a moment is either one the
	 * user may click away from or one that owes them an honest exit, never both.
	 */
	dismissable: boolean;
	/** Whether this moment traps the user, and so must offer a way out. */
	escapable: boolean;
	/** The words for that way out, which is also where the kind reaches the user. */
	escapeCopy: EscapeHatchCopy;
};

export type WalletActivityStore = Readable<WalletActivity> & {
	/**
	 * The user has stopped waiting. Releases the prompt and whatever started the
	 * send, and cancels the flow ONLY when nothing can be lost by it.
	 * See {@link stopWaitingForWallet}.
	 */
	stopWaiting(): Promise<StopWaitingOutcome>;
};

/** The ledger surface this needs. See `core/transaction/in-flight-store`. */
export type ActivityLedger = Readable<{dispatching: number}> &
	ReconcilableLedger;

/**
 * A ledger for a connection the app never dispatches through.
 *
 * AN APP CAN HAVE MORE THAN ONE CONNECTION, and the ledger belongs to the one
 * that SENDS. A variant with a separate payment connection gives each its own
 * flow UI, and handing both the app's single ledger made the second one claim
 * "please confirm the request in your wallet" about a request that belonged to
 * the first: two identical modals on screen, and an escape hatch on the idle
 * connection whose `stopWaiting()` released the other connection's caller.
 *
 * So the flow for a connection that does not dispatch is given this, and says
 * nothing. Inert rather than optional, because `undefined` would put a
 * "do we have a ledger" branch into every reader of the derived value, which is
 * precisely the per-consumer combining this module exists to remove.
 */
export function inertActivityLedger(): ActivityLedger {
	return {
		subscribe: readable({dispatching: 0}).subscribe,
		reconcile: async () => {},
		stopAwaiting: () => {},
	};
}

export function createWalletActivity(params: {
	connection: Readable<ConnectionStateSnapshot>;
	inFlight: ActivityLedger;
	/** `connection.cancel`, passed rather than reached for, so this stays testable. */
	cancelConnection: () => void;
}): WalletActivityStore {
	const {connection, inFlight, cancelConnection} = params;
	const stoppedWaiting = createStoppedWaiting();

	const store = derived(
		[connection, inFlight, stoppedWaiting],
		([$connection, $inFlight, $stoppedWaiting]): WalletActivity => {
			const options = {dispatchInFlight: $inFlight.dispatching > 0};
			const escapable = offersEscapeHatch($connection, options);
			return {
				// Derived from `escapable` rather than computed alongside it, so the
				// two cannot disagree about the same moment.
				dismissable: !escapable,
				promptUser: shouldPromptForWalletAction(
					$connection,
					$stoppedWaiting,
					options,
				),
				escapable,
				escapeCopy: escapeHatchCopy($connection, options),
			};
		},
	);

	return {
		subscribe: store.subscribe,
		// READ LIVE, not captured from the derivation.
		//
		// `derived` does not run its callback until something subscribes, so
		// anything the derivation stashes for this action is absent on a store
		// nobody is watching. Reading a stashed `{}` here means "nothing is
		// outstanding", which sends this straight to the connection-cancelling
		// branch: the disconnect-and-lose-the-transaction bug, for the third time,
		// now triggered by a rendering detail rather than by a mismatched source.
		// `get` makes the action independent of who is looking, which is the only
		// version of this that is safe to hand an adopter.
		stopWaiting: () =>
			stopWaitingForWallet(
				get(connection),
				{cancel: cancelConnection},
				inFlight,
				stoppedWaiting.stopWaitingFor,
				{dispatchInFlight: get(inFlight).dispatching > 0},
			),
	};
}
