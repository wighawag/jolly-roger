import type {
	AnyConnectionStore,
	Connection,
	UnderlyingEthereumProvider,
} from '@etherplay/connect';

/**
 * Connection-flow view helpers.
 *
 * These interpret the connection store's state for the flow UI. They are pure
 * (operate on the state snapshot) so the presentation logic is testable and out
 * of the .svelte file.
 */

/** The value emitted by the app's connection store (`$connection`). */
type ConnectionState = Connection<UnderlyingEthereumProvider>;

/**
 * Structural subset of {@link ConnectionState} these helpers actually read.
 *
 * Deriving each field from the real union (rather than re-declaring loose
 * shapes) means a rename of `step`, `mechanism.type`/`.name`, or
 * `wallet.pendingRequests` upstream fails the typecheck here, while still
 * letting tests pass lightweight fixtures. The fields are `Partial` because
 * `mechanism`/`wallet` only exist on some steps of the union.
 */
type ConnectionStateSnapshot = Partial<
	Pick<ConnectionState, 'step'> & {
		mechanism: Partial<{type: string; name: string; address: string}>;
		wallet: Partial<{
			pendingRequests: readonly unknown[];
			accountChanged: `0x${string}`;
		}>;
	}
>;

/** A wallet as exposed by the connection store's `wallets` array. */
type WalletInfoSnapshot = {info: {name: string; icon: string}};

/**
 * How the wallet-connect entry point should present itself.
 *
 * - `none`: no injected wallets detected, show the get-a-wallet fallback.
 * - `single`: exactly one wallet, show a single button that connects to it
 *   directly (no intermediate picker).
 * - `list`: several wallets and the wallet list is the ONLY content of the
 *   modal (wallet-only auth): show the list directly. An intermediate
 *   "Connect a Wallet" button would be pure indirection here.
 * - `collapsed`: several wallets sharing the modal with other sign-in options
 *   (e.g. the email input under hosted sign-in): show one button that opens
 *   the wallet picker, so the list does not drown the other options.
 */
export type WalletEntryMode = 'none' | 'single' | 'list' | 'collapsed';

export function walletEntryMode(
	wallets: readonly WalletInfoSnapshot[],
	hasOtherSignInOptions: boolean,
): WalletEntryMode {
	if (wallets.length === 0) return 'none';
	if (wallets.length === 1) return 'single';
	return hasOtherSignInOptions ? 'collapsed' : 'list';
}

/**
 * The account a sign-in should actually use.
 *
 * The library records the account chosen at connect time in
 * `mechanism.address`, but if the user swaps their active account in the wallet
 * UI while sitting on the confirm screen, the new account is surfaced as
 * `wallet.accountChanged` (the mechanism address stays stale). Signing without
 * adopting the change would sign with the OLD account. This returns the account
 * the UI should display and adopt: the swapped-to account when present,
 * otherwise the originally connected one.
 */
export function resolveSignInAddress(
	state: ConnectionStateSnapshot,
): `0x${string}` | undefined {
	return (
		state.wallet?.accountChanged ??
		(state.mechanism?.address as `0x${string}` | undefined)
	);
}

/**
 * Whether the user swapped their active wallet account while on the confirm
 * screen (so the UI can hint that the shown account changed).
 */
export function hasSwappedAccount(state: ConnectionStateSnapshot): boolean {
	return state.wallet?.accountChanged !== undefined;
}

/**
 * Whether the account-choice step (`ChooseWalletAccount`) should be rendered
 * as a combined "choose + confirm sign in" modal instead of the plain picker.
 *
 * When the connection targets a signature step ('SignedIn'), the plain picker
 * would be immediately followed by the confirm-sign-in screen, asking the user
 * to confirm the account they JUST chose. Combining the two removes that
 * redundant step. When the target is 'WalletConnected' (wallet-only auth,
 * no signature), picking an account IS the last step, so the plain picker
 * stays. Mirrors the confirm modal's own `targetStep !== 'WalletConnected'`
 * condition.
 */
export function combinesAccountChoiceWithSignIn(connection: {
	targetStep: string;
}): boolean {
	return connection.targetStep !== 'WalletConnected';
}

/**
 * The account the combined choose+sign-in modal should currently highlight.
 *
 * Follows the wallet's active account (`accounts[0]`) until the user
 * explicitly picks a row (`userChoice`). A user choice that is no longer in
 * the list (account disconnected in the wallet UI) falls back to the wallet's
 * active account rather than pointing at something unselectable.
 */
export function effectiveAccountSelection(
	accounts: readonly `0x${string}`[],
	userChoice: `0x${string}` | undefined,
): `0x${string}` | undefined {
	if (
		userChoice &&
		accounts.some((a) => a.toLowerCase() === userChoice.toLowerCase())
	) {
		return userChoice;
	}
	return accounts[0];
}

/** Minimal connection-store surface the sign-in action needs. */
type SignInConnection = Pick<
	AnyConnectionStore<UnderlyingEthereumProvider>,
	'subscribe' | 'connectToAddress' | 'requestSignature'
>;

/**
 * Adopt `address` as the connected account, then request the sign-in
 * signature, as a single user action.
 *
 * Used by the combined choose+sign-in modal (from `ChooseWalletAccount`) and
 * by the swap-adoption path on the confirm screen. `connectToAddress` is
 * fire-and-forget, so we observe the store until it settles on
 * `WalletConnected` for `address` before requesting the signature. Rejects if
 * the flow is cancelled or times out; the caller decides how to surface that
 * (typically by falling back to the confirm screen).
 */
export async function signInToAccount(
	connection: SignInConnection,
	address: `0x${string}`,
): Promise<void> {
	connection.connectToAddress(address);
	await waitForConnected(connection, address);
	await connection.requestSignature();
}

/**
 * Sign in from the confirm screen with a single user action.
 *
 * If the user swapped their active wallet account (so `accountChanged` is set),
 * pressing Sign In should count as confirming that account: adopt it via
 * `connectToAddress`, wait for the store to settle back on `WalletConnected`
 * with the new address (and the swap flag cleared), then request the signature,
 * without a second click. If no swap happened, request the signature directly.
 *
 * `connectToAddress` is fire-and-forget (returns void), so we observe the store
 * to know when the adopted account is ready to sign.
 */
export async function signInAdoptingSwap(
	connection: SignInConnection,
): Promise<void> {
	const state = readConnection(connection);
	const swappedTo = state.wallet?.accountChanged;

	if (!swappedTo) {
		await connection.requestSignature();
		return;
	}

	await signInToAccount(connection, swappedTo);
}

/** Read the current value of the connection store synchronously. */
function readConnection(connection: SignInConnection): ConnectionState {
	let current!: ConnectionState;
	connection.subscribe((v) => {
		current = v;
	})();
	return current;
}

/**
 * Resolve once the store is back on `WalletConnected` for `address` with no
 * pending swap, i.e. the adopted account is ready to be signed with. Rejects if
 * the flow leaves the wallet-connected path (e.g. cancelled) or on timeout.
 */
function waitForConnected(
	connection: SignInConnection,
	address: `0x${string}`,
	timeoutMs = 15_000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		// May be reassigned by subscribe(); guarded so a synchronous first emission
		// (which can settle before subscribe() returns) doesn't touch it too early.
		let unsubscribe: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			unsubscribe?.();
			fn();
		};

		timer = setTimeout(
			() =>
				finish(() =>
					reject(new Error('timed out adopting the swapped account')),
				),
			timeoutMs,
		);

		unsubscribe = connection.subscribe((v) => {
			if (
				v.step === 'WalletConnected' &&
				v.wallet?.accountChanged === undefined &&
				v.mechanism?.address?.toLowerCase() === address.toLowerCase()
			) {
				finish(resolve);
			} else if (
				v.step === 'Idle' ||
				v.step === 'MechanismToChoose' ||
				v.step === 'WalletToChoose'
			) {
				finish(() => reject(new Error('sign-in cancelled')));
			}
		});

		// If the subscriber settled synchronously before assignment above, tidy up.
		if (settled) unsubscribe?.();
	});
}

/**
 * A burner wallet is still in its selection phase (not yet actively connecting).
 *
 * TODO: replace this burner-wallet-specific detection with a generic signal,
 * e.g. an `auto` mode or a provider field like `requiresNoUserConfirmation`.
 */
export function isBurnerWalletInSelectionPhase(
	state: ConnectionStateSnapshot,
): boolean {
	return (
		state.step !== 'Idle' &&
		state.step !== 'MechanismToChoose' &&
		state.mechanism?.type === 'wallet' &&
		state.mechanism?.name === 'Burner Wallet'
	);
}

/**
 * Whether a dismissal (clicking away, or escape) should be honoured.
 *
 * NOT WHILE THE WALLET IS THINKING. A wallet opens in its own window and takes
 * the focus; the first click back on the page lands outside whatever dialog is
 * up, which a dialog reads as "close me". Cancelling a connection at that
 * moment throws away a request the user has already started answering, and the
 * only symptom is that the flow silently stops.
 *
 * AND NOT WHEN A REQUEST IS OUTSTANDING, which is the clause that carries the
 * real risk. The app cannot withdraw a request the wallet already has. Tearing
 * the flow down here only makes the APP forget; the request is still sitting in
 * the wallet, and the user may approve it minutes later. For a signature or an
 * account request that is merely untidy, but the same predicate guards steps
 * that can have a transaction outstanding, and there it is dangerous: the
 * transaction lands, the app never recorded it, and anything waiting to be
 * resolved against it (a commit expecting its reveal) can no longer be.
 *
 * So these steps deliberately offer NO app-side cancel, and that is a real
 * trade rather than an oversight. What they DO offer is the escape hatch below
 * ({@link offersEscapeHatch}), which is a different thing: it tells the user the
 * request is still with their wallet and the app cannot recall it, instead of
 * pretending to undo it.
 *
 * The steps that ARE dismissable are the ones merely waiting on the user inside
 * the app (choosing a wallet or an account, confirming a sign-in), where
 * clicking away means what it says.
 */
export function canDismissConnection(state: ConnectionStateSnapshot): boolean {
	return (
		state.step !== 'WaitingForWalletConnection' &&
		state.step !== 'WaitingForSignature' &&
		state.step !== 'PopupLaunched' &&
		!hasPendingWalletRequest(state)
	);
}

/**
 * Whether to show the "confirm the request in your wallet" prompt: there is a
 * pending wallet request and we're not in the burner-wallet selection phase.
 */
export function hasPendingWalletRequest(
	state: ConnectionStateSnapshot,
): boolean {
	return (
		(state.wallet?.pendingRequests?.length ?? 0) > 0 &&
		!isBurnerWalletInSelectionPhase(state)
	);
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
 * {@link hasPendingWalletRequest} asks whether the wallet is holding something,
 * which is a fact about the wallet. This asks whether to keep BLOCKING THE USER
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
