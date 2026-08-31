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
 * One entry of `connection.pendingRequests`, as far as this app reads it.
 *
 * A DELIBERATE WIDENING of what used to be `readonly unknown[]`, taken when
 * @etherplay/connect 0.10.0 gave `PendingRequest` its `purpose` and `account`
 * fields. The loose version was right while the list was untrustworthy and the
 * app only ever counted it; now that the list survives a wallet-state rebuild,
 * the app reads the entries and says different words about them, so the shape
 * it reads should be the shape the typecheck enforces.
 *
 * THE TWO FIELDS ARE TYPED DIFFERENTLY ON PURPOSE, because a change to each
 * means something different here:
 *
 * - `kind` is the upstream union verbatim, so ADDING A KIND FAILS THIS BUILD.
 *   That is wanted: `outstandingRequestKind` returns those two values and the
 *   escape hatch says something materially different about each (a signature
 *   approved late is untidy, a transaction approved late moves funds). A third
 *   kind is a question nobody here has answered yet, and it should be answered
 *   deliberately rather than falling into whichever branch is last.
 * - `purpose` is `string`, NOT the upstream union, so ADDING A PURPOSE DOES
 *   NOT. The union is expected to grow, and a purpose only chooses flavour
 *   text: an unrecognised one falls back to `kind` (see `walletPromptCopy`),
 *   which is always safe. Pinning it here would turn every upstream addition
 *   into a build break in an app that would have coped fine.
 *
 * Both are optional, and `id` with them, because these are read out of a
 * request the caller made and a caller is not obliged to make one this layer
 * can read.
 */
export type PendingRequestSnapshot = {
	id?: string;
	kind?: 'transaction' | 'signature';
	/** WHY the library is asking, when the library is the one asking. */
	purpose?: string;
	/** WHO is expected to answer: the signer of a signature, a transaction's `from`. */
	account?: `0x${string}`;
};

/**
 * Structural subset of {@link ConnectionState} these helpers actually read.
 *
 * Deriving each field from the real union (rather than re-declaring loose
 * shapes) means a rename of `step`, `mechanism.type`/`.name`, or
 * `pendingRequests` upstream fails the typecheck here, while still letting
 * tests pass lightweight fixtures. The fields are `Partial` because
 * `mechanism`/`wallet` only exist on some steps of the union.
 *
 * `pendingRequests` SITS BESIDE `wallet`, NOT INSIDE IT, since
 * @etherplay/connect 0.11.0 moved it there and deprecated the mirror. That is
 * not a tidy-up to follow later: the list describes what the always-on wrapper
 * is holding, and the wrapper outlives any particular wallet state, so the
 * states that carry NO wallet are exactly the ones this app needed it in. A
 * bare `connect()` on a locked wallet rests on the wallet picker with
 * `wallet: undefined` while the user's wallet is still holding the transaction
 * that raised the flow, and reading the deprecated mirror there answers
 * `undefined` for a request that is very much outstanding.
 *
 * So `^0.11.0` in package.json is a FLOOR rather than a preference. Reading only
 * the new field is deliberate: accepting `state.pendingRequests ?? state.wallet
 * ?.pendingRequests` would restore the exact ambiguity this move removed, in
 * which an empty answer means either "nothing is outstanding" or "this state has
 * no wallet to ask". Against 0.10.0 the app therefore sees no wallet request at
 * all, and `e2e/tests/escape-hatch.e2e.ts` fails loudly rather than degrading.
 */
export type ConnectionStateSnapshot = Partial<
	Pick<ConnectionState, 'step'> & {
		pendingRequests: readonly PendingRequestSnapshot[];
		mechanism: Partial<{type: string; name: string; address: string}>;
		wallet: Partial<{
			accountChanged: `0x${string}`;
			/**
			 * Pinned to the upstream union rather than widened to `string`, on the
			 * same reasoning as `kind`: each value names a different thing the user
			 * can DO about it, so a fourth is a decision somebody has to make rather
			 * than a label to fall through. Passing the real `Connection` here is
			 * what makes that a compile error.
			 */
			status: 'connected' | 'locked' | 'disconnected';
			unlocking: boolean;
		}>;
	}
>;

/**
 * THE GUARD `Partial` CANNOT GIVE ON ITS OWN, and the reason it is spelled out
 * rather than left implied by the snapshot above.
 *
 * The doc on {@link ConnectionStateSnapshot} claims that a rename upstream fails
 * the typecheck here. For `step` that is true, because it is `Pick`ed from the
 * real union. For the fields this app re-declares it was never true: every field
 * is optional, so the real `Connection` stays assignable to the snapshot after
 * upstream drops or renames one, and the app would simply read `undefined` for a
 * request the wallet is genuinely holding. Exactly the silence this whole module
 * exists to prevent, arriving through the type system instead of the store.
 *
 * `pendingRequests` cannot be `Pick`ed to fix that, because the real element
 * type has four required fields and the tests here pass deliberately partial
 * fixtures. So the shape is asserted separately, which catches BOTH failure
 * modes and costs nothing at runtime:
 *
 * - the field moving or being renamed makes the indexed access itself an error;
 * - a new `kind` makes the element no longer assignable, so `Assert<false>`
 *   errors. That is wanted, for the reason given on
 *   {@link PendingRequestSnapshot}: a third kind changes what the app must say
 *   about danger. A new `purpose` still passes, because it is typed `string`.
 */
type Assert<T extends true> = T;
type _PendingRequestsStillLiveOnTheConnection = Assert<
	ConnectionState['pendingRequests'] extends readonly PendingRequestSnapshot[]
		? true
		: false
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
 * WHETHER THE WALLET CAN ANSWER ANYTHING RIGHT NOW.
 *
 * A locked wallet keeps `step: 'WalletConnected'`, so every
 * `isTargetStepReached` check in this app reads it as connected and it renders
 * exactly like a working one. Measured, not assumed: with a transaction parked
 * and the wallet locked, the navbar showed a balance and the page offered no
 * Connect button, no Unlock, and no hint that anything was wrong, while the
 * wallet-action modal told the user to approve a request their locked wallet was
 * not showing them. That is the same false instruction as "confirm in your
 * wallet" during a silent dispatch, arriving from the other side.
 *
 * `unlocking` is a state of its own rather than a flag on `locked`, because a
 * control that stays live during it invites a second `unlock()` that does
 * nothing, and one that simply vanishes reads as the app having lost interest.
 *
 * `disconnected` is deliberately NOT treated as locked. It means the wallet has
 * revoked this site rather than gone to sleep, and the remedy is a fresh connect
 * (a permission prompt), not an unlock (a password prompt). Offering the wrong
 * one of those is a dead end the user cannot tell from a broken app.
 */
export type WalletLockState = 'unlocked' | 'locked' | 'unlocking';

export function walletLockState(
	state: ConnectionStateSnapshot,
): WalletLockState {
	if (state.wallet?.status !== 'locked') return 'unlocked';
	return state.wallet.unlocking ? 'unlocking' : 'locked';
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
 * trade rather than an oversight. What they DO offer is the escape hatch
 * (`offersEscapeHatch` in ./wallet-activity), which is a different thing: it
 * tells the user the request is still with their wallet and the app cannot
 * recall it, instead of pretending to undo it.
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
		(state.pendingRequests?.length ?? 0) > 0 &&
		!isBurnerWalletInSelectionPhase(state)
	);
}
