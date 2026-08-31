import {derived, get, readable, writable, type Readable} from 'svelte/store';
import {
	canDismissConnection,
	isBurnerWalletInSelectionPhase,
	resolveSignInAddress,
	walletLockState,
	type ConnectionStateSnapshot,
	type PendingRequestSnapshot,
} from './connection-flow';

/**
 * WHAT THE WALLET IS HOLDING, and how the app lets the user out of it.
 *
 * ONE PLACE THAT RECONCILES THE SOURCES, which is the whole reason this module
 * exists. There are three, and they disagree by nature:
 *
 * - `connection.pendingRequests`, the connection library's list. AUTHORITATIVE
 *   about the wallet since @etherplay/connect 0.10.0, and only since then: every
 *   wallet-state rebuild used to assert `pendingRequests: []`, which erased an
 *   outstanding request permanently, because the list is only written on request
 *   events and the next event for a request is the one that ends it. 0.10.0
 *   copied the live list from the provider wrapper at every rebuild, and 0.11.0
 *   moved the list OFF the wallet object entirely, so it also survives the
 *   states that carry no wallet at all. It still knows only about requests THE
 *   WALLET WAS ASKED, which is not the same set as the sends this app is waiting
 *   on.
 * - `$inFlight.dispatching`, the app's OWN count of sends it has made and not had
 *   answered, with `$inFlight.prompting` for the subset of those a human at a
 *   wallet has to answer. It covers what the list cannot: a send signed by a key
 *   the app holds itself, which no wallet is ever asked about, and the beat
 *   between `handle.dispatched()` and the wallet actually receiving the request.
 *   It knows nothing about signature or connection requests.
 * - the requests the user has already given up on, which must stop a prompt
 *   reappearing without silencing the NEXT request.
 *
 * WHAT THE UPSTREAM FIXES CHANGED HERE, since the next reader will otherwise
 * conclude the ledger was a workaround and delete it (ADR-0008, `work` branch).
 * It changed the PRECEDENCE and the justification, not the existence. The ledger
 * is no longer the more trustworthy answer to "is the wallet holding something";
 * it is the answer to a DIFFERENT question, "is this app still waiting on a send",
 * and the two questions have never had the same answer for an app that also signs
 * locally. Each preference below now names which of those two durable reasons it
 * rests on, and none of them is the erasure bug any more.
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
 * What the APP knows about its own sends, as opposed to what the connection
 * library reports. Two questions, because they stopped having one answer.
 *
 * NOT in `wallet-activity-boundary.test.ts`'s sanctioned list, deliberately: it
 * exists to be passed to the primitives below, and app code reaching for a
 * primitive is the thing that rule forbids. An app wiring a local signer needs
 * `guardDispatch(client, ledger, {prompts: false})` and nothing from here; the
 * answer arrives through {@link createWalletActivity} like every other.
 */
export type DispatchActivity = {
	/**
	 * Whether the APP is still waiting on a dispatch of its own
	 * (`$inFlight.dispatching > 0`), whoever signs it.
	 *
	 * A DIFFERENT SOURCE from `connection.pendingRequests`, not a more trustworthy
	 * one. It used to be the latter, and that reason has expired: the library's
	 * list was erased by every wallet-state rebuild until @etherplay/connect
	 * 0.10.0, so the app kept its own record to stop the modal and the escape hatch
	 * vanishing under a user who was still holding a wallet popup. 0.10.0 fixed the
	 * erasure and 0.11.0 closed the wallet-less states it left open.
	 *
	 * TWO REASONS SURVIVE THAT FIX, and they are why this field stays:
	 *
	 * 1. A SEND THE WALLET NEVER SEES. A dispatch signed by a key the app holds
	 *    itself never enters `pendingRequests`, because no wallet was asked
	 *    anything. It is still outstanding, still losable by a reload, and still
	 *    something the user can be trapped by. No upstream fix can put it in a list
	 *    of wallet requests, because it is not one.
	 * 2. A BEAT EARLIER. `guardDispatch` calls `handle.dispatched()` immediately
	 *    before handing the send to viem, which then reads a chain id, a nonce and
	 *    a gas estimate through the same provider before `eth_sendTransaction` is
	 *    ever issued. Against a slow public RPC that is seconds during which this is
	 *    true and the list is legitimately empty. What the app must NOT do in that
	 *    window is claim the wallet is asking (see {@link walletPromptCopy}), but it
	 *    is still activity, and closing the tab in it still loses a transaction.
	 *
	 * This is the ACTIVITY question: is something outstanding that the user could
	 * be trapped by, or destroy by clicking the wrong thing.
	 */
	dispatchInFlight?: boolean;
	/**
	 * Whether any of those dispatches needs A HUMAN AT A WALLET
	 * (`$inFlight.prompting > 0`).
	 *
	 * The narrower question, and the only one {@link shouldPromptForWalletAction}
	 * asks. A dispatch signed by a key the app holds itself is outstanding, can
	 * still be lost by a reload, and still deserves everything above; what it does
	 * NOT deserve is a modal telling the user to go and approve something, because
	 * no wallet asked them anything.
	 *
	 * Recorded at dispatch time by `guardDispatch`, never inferred from a count:
	 * a count of sends cannot tell a wallet apart from a local signer, and reading
	 * one as the other is what flashed "Wallet Action Required" several times a
	 * minute in an app with a short round loop.
	 *
	 * Omitted means "assume they all prompt", which is what was true before this
	 * distinction existed, so a caller that has not thought about it keeps the
	 * loud behaviour rather than silently losing the modal for a real wallet.
	 */
	promptingDispatchInFlight?: boolean;
};

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
	options?: DispatchActivity,
): boolean {
	// KEPT, AND NARROWER THAN IT WAS. A dispatch the app is still waiting on traps
	// the user just as surely as a step that refuses dismissal, so it has to carry
	// an exit.
	//
	// For a WALLET dispatch this clause is now redundant: since 0.10.0 the request
	// is in `pendingRequests` for its whole life, so `hasPendingWalletRequest` is
	// true and `!canDismissConnection` already says so. What it still covers alone
	// is exactly reason 1 and reason 2 on `dispatchInFlight`: a send signed
	// locally, which will never appear in a list of wallet requests, and the beat
	// before the wallet has been handed anything. Both are moments where the user
	// is genuinely stuck and the library, correctly, reports nothing.
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
	options?: DispatchActivity,
): 'transaction' | 'signature' | undefined {
	// KEPT, AND MORE LOAD-BEARING THAN BEFORE, which is the opposite of what the
	// 0.10.0 fix looks like it should have done to this line.
	//
	// It used to be justified by the erasure bug: the list went missing, so the
	// app's own count had to outrank it. That reason is gone. The reason that
	// replaced it is sharper. This function decides whether `stopWaitingForWallet`
	// may call `connection.cancel()`, and cancelling with a transaction in flight
	// is the disconnect-and-lose-the-transaction bug. Consider a send the app
	// signed ITSELF (invisible to the list, by definition) while the wallet holds a
	// signature request. Reading the list first would answer 'signature' and take
	// the cancelling branch, and lose the transaction.
	//
	// That combination barely existed before 0.10.0 and now does, because the same
	// release routed `getDelegation` and `getSignatureForPublicKeyPublication`
	// through the wrapper: library-originated signatures are announced now, so a
	// signature sitting in the list alongside a silent dispatch is an ordinary
	// state rather than a hypothetical. Making the wallet more visible raised the
	// stakes on this ordering instead of retiring it.
	//
	// A dispatch is by definition a transaction, so it answers with the kind that
	// gets the careful words and the careful branch.
	if (options?.dispatchInFlight) return 'transaction';

	const requests = state.pendingRequests ?? [];
	let seen: 'transaction' | 'signature' | undefined;
	for (const request of requests) {
		// A transaction outranks a signature: with both outstanding, the sentence
		// has to be about the one that can spend money.
		if (request.kind === 'transaction') return 'transaction';
		if (request.kind === 'signature') seen = 'signature';
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
	options?: DispatchActivity,
): EscapeHatchCopy {
	// A SILENT DISPATCH NEVER SPEAKS FOR THE WALLET, and this is the second half
	// of the same fix as `shouldPromptForWalletAction`. Suppressing the modal
	// titled "Wallet Action Required" and then, one click later, telling the same
	// user "your wallet still has this transaction ... if you approve it later"
	// leaves the untruth exactly where this module says the feature lives: in the
	// wording.
	//
	// So when the only outstanding transaction is one the app signed itself, the
	// words come from what the WALLET is holding (read with no options at all,
	// i.e. the library's list alone) and the dispatch speaks only for itself.
	// Three cases fall out, all of them true: the wallet holds a transaction, so
	// say so; the wallet holds a signature, so say THAT rather than letting the
	// silent send outrank it into transaction wording; the wallet holds nothing,
	// so describe what is actually happening, which is this app sending something
	// nobody was asked about.
	//
	// `outstandingRequestKind` itself is deliberately NOT narrowed this way: it
	// decides whether `stopWaitingForWallet` may cancel the connection, and a
	// silent transaction in flight must take the release-the-prompt branch just as
	// firmly as a loud one. What to TEAR DOWN and what to SAY are different
	// questions, and this is the one about saying.
	const silentDispatch =
		options?.dispatchInFlight === true &&
		options?.promptingDispatchInFlight === false;
	const kind = silentDispatch
		? outstandingRequestKind(state)
		: outstandingRequestKind(state, options);

	if (silentDispatch && kind === undefined) {
		return {
			trigger: 'Stop waiting',
			title: 'This app is still sending a transaction',
			body: 'Your wallet has not been asked for anything: this app signed this transaction itself, so there is nothing for you to approve. It cannot be taken back either. Stopping here only means this app gives up waiting for the answer. If it was sent, it still counts, and we will tell you what we can find out.',
			confirm: 'Stop waiting',
			dismiss: 'Keep waiting',
		};
	}

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

/**
 * Ids of the requests the wallet is holding right now.
 *
 * SILENTLY REPAIRED BY 0.10.0, and worth saying because nothing here changed.
 * `stopWaitingForWallet` feeds this to the stopped-waiting set, so an emptied
 * list meant it recorded no ids at all and the id-based suppression did nothing:
 * the modal stayed down only because `stopAwaiting()` had zeroed the ledger, and
 * would have come back had the list ever repopulated. Now the ids are really
 * there, so the mechanism designed in `createStoppedWaiting` (give up on THIS
 * request, keep prompting for the next) works as written for the first time.
 */
export function pendingRequestIds(state: ConnectionStateSnapshot): string[] {
	const requests = state.pendingRequests ?? [];
	return requests
		.map((request) => request.id)
		.filter((id): id is string => typeof id === 'string');
}

/** Requests the wallet is holding that the user has not given up on. */
function liveRequests(
	state: ConnectionStateSnapshot,
	stoppedWaitingFor: ReadonlySet<string>,
): readonly PendingRequestSnapshot[] {
	const requests = state.pendingRequests ?? [];
	// A request with no id cannot be stopped-waiting-on individually, so it still
	// counts. Better to show a modal the user has already dismissed than to hide
	// one they have never seen.
	return requests.filter(
		(request) =>
			typeof request.id !== 'string' || !stoppedWaitingFor.has(request.id),
	);
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
	options?: DispatchActivity,
): boolean {
	// Still suppressed for the burner, which needs no human confirmation: a
	// prompt asking for one would be a lie, and its dispatch settles in
	// milliseconds so the app's own signal would only make the modal flash.
	if (isBurnerWalletInSelectionPhase(state)) return false;

	const outstanding = liveRequests(state, stoppedWaitingFor).length > 0;

	// THE PROMPTING ONES, NOT ALL OF THEM, and this is the one consumer that
	// makes that distinction. This modal is an instruction to a person to go and
	// approve something, so the only dispatch that may raise it is one a person has
	// actually been asked about. A local signer sends with no dialog and nothing
	// waiting on the user, and a modal telling them otherwise is a false
	// instruction that they cannot act on and that vanishes before they can read
	// it.
	//
	// Everything ELSE about that same dispatch is unchanged and deliberately so:
	// it still offers the escape hatch (above), still arms the unload guard, and
	// still lights the sending indicator (`ui/in-flight/sending.ts`), because a
	// silent transaction is just as losable as a loud one. What narrows here is
	// only the instruction to go and look at a wallet.
	//
	// Falls back to `dispatchInFlight` when nobody has said, so a caller that
	// knows nothing of silent signers behaves exactly as before.
	const promptingDispatch =
		options?.promptingDispatchInFlight ?? options?.dispatchInFlight;

	// KEPT AS A DISJUNCT, DEMOTED IN THE WORDING, and this is the one place the
	// 0.10.0 fix changed something real (ADR-0008, `work` branch).
	//
	// This term cannot rest on either reason that saves `dispatchInFlight`
	// elsewhere: a locally-signed send never sets `prompting`, so reason 1 does not
	// apply, and reason 2, the beat before the wallet has been handed anything, is
	// precisely a window in which "please confirm the request in your wallet" is
	// FALSE. `in-flight-store` already moved this counter once for exactly that,
	// from `record()` to `dispatched()`, and it could not move it far enough: viem
	// still reads a chain id, a nonce and a gas estimate before the wallet is
	// asked.
	//
	// So it would be tempting to delete it now that the list is reliable, and that
	// would be the wrong half to drop. What is worth keeping is the BLOCK: the user
	// should not be clicking around a form whose send is already committed, and
	// this is the moment the escape hatch has to be reachable from. What is worth
	// dropping is the CLAIM. Before 0.10.0 the two were inseparable, because an
	// empty list meant either "not asked yet" or "asked, then erased" and nothing
	// here could tell them apart, so the loud wording had to cover both. Now an
	// empty list means exactly one thing, and `walletPromptCopy` says that thing
	// instead. The boolean stays; the sentence changed.
	//
	// Stopping waiting clears the app's live dispatches too (see
	// `stopWaitingForWallet`), so this needs no separate suppression.
	return outstanding || promptingDispatch === true;
}

/** The words of the wallet-action modal. See {@link walletPromptCopy}. */
export type WalletPromptCopy = {
	title: string;
	body: string;
};

/** `0x1234...cdef`, for naming an account in a sentence. */
function shortAddress(address: string): string {
	return address.length <= 12
		? address
		: `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * The request whose words the modal should use, among those still live.
 *
 * A transaction over a signature, for the same reason as
 * {@link outstandingRequestKind}: with both outstanding the sentence has to be
 * about the one that can spend money. Among equals the oldest wins, which is the
 * one the user has been staring at.
 */
function requestToDescribe(
	requests: readonly PendingRequestSnapshot[],
): PendingRequestSnapshot | undefined {
	return (
		requests.find((request) => request.kind === 'transaction') ?? requests[0]
	);
}

/**
 * WHAT the wallet is asking, in the words the user sees.
 *
 * The modal used to be titled "Wallet Action Required" over "Please confirm the
 * request in your wallet", for everything, always. That was all the app could
 * honestly say: the library's list held only a `kind`, and an empty list was
 * ambiguous between "not asked yet" and "asked, then erased by a wallet-state
 * rebuild". @etherplay/connect 0.10.0 removed both limits at once, so three
 * sentences are now available that were not:
 *
 * - PURPOSE. `purpose` names what a library-originated signature is FOR. It is
 *   worth naming: a delegation grants a key in this browser authority to act for
 *   the user's account, and an unexplained request for exactly that is the shape
 *   a phishing prompt takes, so a user who cannot tell the two apart is right to
 *   be suspicious of both. ABSENT means the app itself sent the request through
 *   `connection.provider` and already knows what it sent, so absence is normal
 *   rather than a gap. An unrecognised value falls back to `kind` and never
 *   throws: the union is expected to grow, and a purpose this app has not heard
 *   of is still a request the user must be told about.
 * - WHOSE. A request now survives a wallet-state rebuild, so it can outlive the
 *   wallet state it started under, and the user is free to switch wallet or
 *   account while one is outstanding. `account` is the address expected to
 *   answer. Without it, "approve this in your wallet" points at whichever wallet
 *   is current, which after a switch cannot answer it, and the user is told to
 *   do something impossible. The upstream list is not per-wallet and the wrapper
 *   does not mark or drop a request when the wallet is swapped underneath it, so
 *   comparing this address is the only way that case is detectable from here.
 * - NOT YET ASKED. An empty list beneath a prompting dispatch is now
 *   unambiguous, so it gets its own honest sentence instead of borrowing the
 *   wallet's. See the disjunct in {@link shouldPromptForWalletAction}.
 *
 * Kept in a `.ts` file with {@link escapeHatchCopy}, for the same reason: a
 * review of what the app tells the user is a review of one function.
 */
export function walletPromptCopy(
	state: ConnectionStateSnapshot,
	stoppedWaitingFor: ReadonlySet<string>,
	options?: DispatchActivity,
): WalletPromptCopy {
	const request = requestToDescribe(liveRequests(state, stoppedWaitingFor));

	if (!request) {
		// NOTHING IS WITH THE WALLET, and the modal is up on the strength of the
		// app's own dispatch alone.
		//
		// This branch has narrowed twice as upstream improved, which is the whole
		// argument of ADR-0008 playing out. It once had to cover an erased list
		// (fixed in 0.10.0) and then a list that vanished with the wallet object
		// (fixed in 0.11.0, which moved it beside `wallet`). What is left is the one
		// case no library fix can reach: the window between `handle.dispatched()` and
		// the wallet actually being handed the send.
		//
		// Still written to be true under BOTH readings, because this app cannot prove
		// which it is: the expected one is that window, and the other is an upstream
		// regression that stops announcing requests again. Telling the user their
		// wallet is asking would be false in the first; telling them it is not would
		// be false in the second. So it says what this app is doing and what to do if
		// the wallet has in fact already asked.
		return {
			title: 'Getting your transaction ready',
			body: 'This app is preparing the transaction. Your wallet will ask you to confirm it in a moment; if it has already asked, approve it there.',
		};
	}

	// A LOCKED WALLET IS NOT SHOWING THE USER ANYTHING, so it is checked before
	// every question about what the request IS. "Confirm the transaction in your
	// wallet" is a false instruction here in the most literal way available: the
	// request is real, the wallet has it, and the user cannot see it until they
	// unlock. This is the same class of untruth as speaking for a wallet during a
	// silent dispatch, reached from the other side, and it is the state a user is
	// most likely to be stuck in, because a wallet that auto-locks does it while
	// they are reading the modal.
	//
	// `unlocking` gets its own sentence rather than sharing the locked one: the
	// wallet's password prompt is up, the user is answering it, and repeating
	// "your wallet is locked" at that moment reads as the app not having noticed.
	const lock = walletLockState(state);
	if (lock === 'unlocking') {
		return {
			title: 'Waiting for your wallet to unlock',
			body: 'Your wallet is asking you to unlock it. Once you have, it will show you the request this app is waiting on.',
		};
	}
	if (lock === 'locked') {
		return {
			title: 'Your wallet is locked',
			body: 'This app is waiting on a request your wallet already has, and a locked wallet will not show it to you. Unlock it to see the request and answer it. Nothing has been withdrawn: it is still there waiting.',
		};
	}

	// A REQUEST NO CURRENT WALLET CAN ANSWER, checked before anything about what
	// the request is, because it changes what the user should DO and the rest only
	// changes what it is called. Both addresses have to be known and actually
	// differ: `account` is optional upstream, `mechanism.address` is absent on some
	// steps, and guessing a mismatch from a missing value would send a user
	// hunting through wallets for a request their current one is holding perfectly
	// well.
	const connected = resolveSignInAddress(state);
	if (
		request.account &&
		connected &&
		request.account.toLowerCase() !== connected.toLowerCase()
	) {
		return {
			title: 'This request is for a different account',
			body:
				`This request is waiting on ${shortAddress(request.account)}, and this app is now ` +
				`connected as ${shortAddress(connected)}. Only the wallet holding it can answer it, so ` +
				`switch back to ${shortAddress(request.account)} there, or stop waiting. Nothing is lost ` +
				`either way: if it is approved later it still acts.`,
		};
	}

	// UNRECOGNISED FALLS THROUGH, never throws. See the note above.
	if (request.purpose === 'delegation') {
		return {
			title: 'Approve the delegation in your wallet',
			body: 'This app has asked your wallet for a delegation: a signature that lets a key held in this browser send transactions for your account, so you are not asked to approve each one. Nothing is spent by signing it. Approve it in your wallet only if you started this.',
		};
	}

	if (request.purpose === 'public-key-publication') {
		return {
			title: 'Approve publishing your public key',
			body: 'This app has asked your wallet to sign the publication of a public key for your account, so that others can send you things only you can read. Nothing is spent by signing it.',
		};
	}

	if (request.kind === 'transaction') {
		return {
			title: 'Confirm the transaction in your wallet',
			body: 'Your wallet is asking you to approve a transaction this app sent. It will not be sent until you approve it there.',
		};
	}

	if (request.kind === 'signature') {
		return {
			title: 'Confirm the signature request in your wallet',
			body: 'Your wallet is asking you to sign something this app requested. Nothing is spent by signing it.',
		};
	}

	// A request whose kind this app cannot read. The type says it has one, and the
	// type describes what upstream sends rather than what arrives, so the vaguest
	// true sentence is better than a confident wrong one.
	return {
		title: 'Wallet Action Required',
		body: 'Please confirm the request in your wallet.',
	};
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
	options?: DispatchActivity,
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
	 * WHAT to say while blocking them, which is no longer one fixed sentence.
	 *
	 * A field rather than a component reading `pendingRequests` for itself,
	 * because that is what the boundary rule asks for: the question "what is the
	 * wallet holding" gets one answer, and a consumer that needs a sharper one
	 * adds a field here instead of reaching around it. It is also the reason this
	 * is not `holding: 'transaction' | 'signature'`, the speculative field that
	 * was removed from this type: the kind reaches the user as words, and words
	 * are what a consumer actually renders.
	 */
	promptCopy: WalletPromptCopy;
	/**
	 * Whether to offer "Unlock", because that is the only thing that can move.
	 *
	 * A field here rather than a `walletLockState` call in the component, for the
	 * boundary rule's reason: the modal's words and the modal's button are two
	 * halves of one answer, and a component that computed the button itself could
	 * offer an Unlock beside a sentence about something else. `promptCopy` says
	 * the wallet is locked exactly when this is true.
	 *
	 * False while `unlocking`, deliberately. The wallet's own password prompt is
	 * already up, so a second `unlock()` does nothing a user can see, and a live
	 * button invites it.
	 */
	unlockable: boolean;
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
export type ActivityLedger = Readable<{
	dispatching: number;
	/**
	 * How many of those need a human at a wallet. Separate from `dispatching`
	 * because only this one may raise "Wallet Action Required"; see
	 * {@link DispatchActivity.promptingDispatchInFlight}.
	 */
	prompting: number;
}> &
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
		subscribe: readable({dispatching: 0, prompting: 0}).subscribe,
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
			const options: DispatchActivity = {
				dispatchInFlight: $inFlight.dispatching > 0,
				// Both, always, and never one standing in for the other. A dispatch the
				// app signs itself is activity (an exit, an unload warning) without
				// being an instruction to the user, and the two fields are what keep
				// those apart.
				promptingDispatchInFlight: $inFlight.prompting > 0,
			};
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
				// The SAME stopped-waiting set the decision to prompt was made with, so
				// the modal cannot describe a request the user has already given up on
				// while it is really up for a newer one.
				promptCopy: walletPromptCopy($connection, $stoppedWaiting, options),
				unlockable: walletLockState($connection) === 'locked',
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
				{
					dispatchInFlight: get(inFlight).dispatching > 0,
					promptingDispatchInFlight: get(inFlight).prompting > 0,
				},
			),
	};
}
