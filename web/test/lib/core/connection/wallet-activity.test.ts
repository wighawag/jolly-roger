import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {canDismissConnection} from '../../../../src/lib/core/connection/connection-flow';
import {
	createWalletActivity,
	escapeHatchCopy,
	offersEscapeHatch,
	outstandingRequestKind,
	pendingRequestIds,
	shouldPromptForWalletAction,
	stopWaitingForWallet,
} from '../../../../src/lib/core/connection/wallet-activity';

describe('the escape hatch: an exit that does not lie', () => {
	// The app cannot withdraw a request the wallet already has. Everything here
	// exists so it never offers a control that implies it can.
	it('is offered on exactly the steps that refuse dismissal', () => {
		// Derived from canDismissConnection rather than from its own list of
		// steps, so a step added to that refusal later cannot become a trap.
		const states = [
			{step: 'WaitingForWalletConnection'},
			{step: 'WaitingForSignature'},
			{step: 'PopupLaunched'},
			{
				step: 'WalletConnected',
				wallet: {pendingRequests: [{kind: 'transaction'}]},
			},
			{step: 'Idle'},
			{step: 'WalletToChoose'},
			{step: 'ChooseWalletAccount'},
			{step: 'WalletConnected'},
		] as const;

		for (const state of states) {
			expect(offersEscapeHatch(state), state.step).toBe(
				!canDismissConnection(state),
			);
		}
	});

	it('names a transaction over a signature when both are outstanding', () => {
		// The sentence has to be about the one that can spend money.
		expect(
			outstandingRequestKind({
				wallet: {
					pendingRequests: [{kind: 'signature'}, {kind: 'transaction'}],
				},
			}),
		).toBe('transaction');
	});

	it('reports no outstanding kind when the wallet holds nothing', () => {
		expect(outstandingRequestKind({step: 'WaitingForWalletConnection'})).toBe(
			undefined,
		);
		expect(outstandingRequestKind({wallet: {pendingRequests: []}})).toBe(
			undefined,
		);
	});

	it('never offers to cancel, undo, or take back', () => {
		// "Cancel" would imply the app can undo what the wallet already has, which
		// is precisely the thing it cannot do.
		const states = [
			{step: 'WaitingForWalletConnection'},
			{wallet: {pendingRequests: [{kind: 'transaction'}]}},
			{wallet: {pendingRequests: [{kind: 'signature'}]}},
		] as const;

		for (const state of states) {
			const copy = escapeHatchCopy(state);
			expect(copy.trigger).toBe('Stop waiting');
			expect(copy.confirm).toBe('Stop waiting');
			expect(copy.dismiss).toBe('Keep waiting');
			const words = `${copy.title} ${copy.body}`.toLowerCase();
			expect(words).not.toContain('cancel');
			expect(words).not.toContain('undo');
			// It has to say who still holds the request, every time.
			expect(words).toContain('your wallet');
		}
	});

	it('says the request survives, and that approving it later still acts', () => {
		const transaction = escapeHatchCopy({
			wallet: {pendingRequests: [{kind: 'transaction'}]},
		});
		expect(transaction.title).toContain('still has this transaction');
		expect(transaction.body).toContain('it will still be sent');

		const signature = escapeHatchCopy({
			wallet: {pendingRequests: [{kind: 'signature'}]},
		});
		expect(signature.title).toContain('signature request');
		expect(signature.body).toContain('Nothing is spent');

		const unknown = escapeHatchCopy({step: 'WaitingForWalletConnection'});
		expect(unknown.body).toContain(
			'answering it later will still do what it says',
		);
	});

	it('NEVER cancels the connection when a transaction is outstanding', async () => {
		// The bug this replaces, found in real use and reproduced in a browser:
		// `cancel()` sets the flow Idle, clears the wallet and calls
		// deleteLastWallet(), so the account disappears and account data with it.
		// The user then approves in their wallet, the transaction lands, and
		// `transaction:broadcasted` has nowhere to file it. The escape hatch, whose
		// entire purpose is that approving later still works, was destroying the
		// app's ability to notice that it had.
		const calls: string[] = [];
		const outcome = await stopWaitingForWallet(
			{
				step: 'WalletConnected',
				wallet: {pendingRequests: [{kind: 'transaction', id: 'req_1'}]},
			},
			{cancel: () => calls.push('cancel')},
			{
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => calls.push('stopAwaiting'),
			},
			(ids) => calls.push(`release:${ids.join(',')}`),
		);

		expect(outcome).toBe('released-prompt');
		expect(calls).toEqual(['stopAwaiting', 'release:req_1']);
		expect(calls).not.toContain('cancel');
	});

	it('releases whatever started the send, not just the modal', async () => {
		// Dismissing the modal alone left the page that started the send awaiting a
		// promise the wallet is under no obligation to settle, so its Send button
		// stayed disabled and spinning for ever. Reported from real use.
		const calls: string[] = [];
		await stopWaitingForWallet(
			{wallet: {pendingRequests: [{kind: 'transaction', id: 'req_1'}]}},
			{cancel: () => calls.push('cancel')},
			{
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => calls.push('stopAwaiting'),
			},
			() => {},
		);
		expect(calls).toContain('stopAwaiting');
	});

	it('releases the caller on the cancel path too', async () => {
		const calls: string[] = [];
		await stopWaitingForWallet(
			{step: 'WaitingForSignature'},
			{cancel: () => calls.push('cancel')},
			{
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => calls.push('stopAwaiting'),
			},
			() => {},
		);
		expect(calls).toContain('stopAwaiting');
	});

	it('does not reconcile a transaction it is still listening for', async () => {
		// The app stopped BLOCKING, not listening. Reconciling now would raise "we
		// cannot tell whether this was sent" about a request that is still live and
		// will settle its own record the moment the wallet answers.
		const calls: string[] = [];
		await stopWaitingForWallet(
			{wallet: {pendingRequests: [{kind: 'transaction', id: 'req_1'}]}},
			{cancel: () => calls.push('cancel')},
			{
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => calls.push('stopAwaiting'),
			},
			() => {},
		);
		expect(calls).not.toContain('reconcile');
	});

	it('cancels the flow, then finds out, when nothing can be lost', async () => {
		// Waiting on a connection or a signature: there is no account yet and no
		// transaction to lose, and leaving the flow half-open strands the user on a
		// modal with nothing behind it. Here cancelling is right, and reconciling
		// afterwards is what keeps "we stopped waiting" from becoming "it did not
		// happen".
		const calls: string[] = [];
		const outcome = await stopWaitingForWallet(
			{step: 'WaitingForSignature'},
			{cancel: () => calls.push('cancel')},
			{
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => calls.push('stopAwaiting'),
			},
			() => calls.push('release'),
		);

		expect(outcome).toBe('cancelled-connection');
		expect(calls).toEqual(['stopAwaiting', 'cancel', 'reconcile']);
	});
});

describe('shouldPromptForWalletAction: holding vs blocking', () => {
	const request = (id: string, kind = 'transaction') => ({id, kind});

	it('prompts while the wallet holds something nobody gave up on', () => {
		expect(
			shouldPromptForWalletAction(
				{step: 'WalletConnected', wallet: {pendingRequests: [request('a')]}},
				new Set(),
			),
		).toBe(true);
	});

	it('stops prompting for a request the user gave up on', () => {
		expect(
			shouldPromptForWalletAction(
				{step: 'WalletConnected', wallet: {pendingRequests: [request('a')]}},
				new Set(['a']),
			),
		).toBe(false);
	});

	it('STILL prompts for the next request after one was given up on', () => {
		// The reason this is keyed by id rather than being a flag. A user who gives
		// up on a stuck transaction and then sends another must still be told to
		// confirm that one, and a flag would have made the second send silent.
		expect(
			shouldPromptForWalletAction(
				{step: 'WalletConnected', wallet: {pendingRequests: [request('b')]}},
				new Set(['a']),
			),
		).toBe(true);
	});

	it('prompts when only some of several are given up on', () => {
		expect(
			shouldPromptForWalletAction(
				{
					step: 'WalletConnected',
					wallet: {pendingRequests: [request('a'), request('b')]},
				},
				new Set(['a']),
			),
		).toBe(true);
	});

	it('prompts for a request with no id rather than hiding it', () => {
		// It cannot be given up on individually, so the safe default is to show a
		// modal the user may have dismissed rather than hide one they never saw.
		expect(
			shouldPromptForWalletAction(
				{
					step: 'WalletConnected',
					wallet: {pendingRequests: [{kind: 'transaction'}]},
				},
				new Set(['a']),
			),
		).toBe(true);
	});

	it('says nothing when the wallet holds nothing, and keeps the burner silent', () => {
		expect(
			shouldPromptForWalletAction({wallet: {pendingRequests: []}}, new Set()),
		).toBe(false);
		expect(
			shouldPromptForWalletAction(
				{
					step: 'WalletConnected',
					mechanism: {type: 'wallet', name: 'Burner Wallet'},
					wallet: {pendingRequests: [request('a')]},
				},
				new Set(),
			),
		).toBe(false);
	});

	it('reads the ids the wallet is holding', () => {
		expect(
			pendingRequestIds({
				wallet: {pendingRequests: [request('a'), request('b'), {kind: 'x'}]},
			}),
		).toEqual(['a', 'b']);
		expect(pendingRequestIds({step: 'Idle'})).toEqual([]);
	});
});

describe("the app's own dispatch as a second source of truth", () => {
	// Reported: with a locked Rabby, no "Wallet Action Required" modal appeared
	// for a transaction being sent. `wallet.pendingRequests` is transient library
	// state that a wallet state rebuild resets to [] while the request is still
	// outstanding, and unlocking a locked wallet is exactly such a rebuild. The
	// app's own in-flight record does not have that problem.
	it('prompts when the app is dispatching, even if the library shows nothing', () => {
		expect(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set(), {
				dispatchInFlight: true,
			}),
		).toBe(true);
		// Without the app's own signal, this is the silence that was reported.
		expect(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set()),
		).toBe(false);
	});

	it('offers the escape hatch on the strength of a dispatch alone', () => {
		// A dispatch nobody has answered traps the user just as surely as a step
		// that refuses dismissal, so it must carry an exit even when the library
		// has lost track of the request.
		const state = {step: 'WalletConnected'} as const;
		expect(canDismissConnection(state)).toBe(true);
		expect(offersEscapeHatch(state)).toBe(false);
		expect(offersEscapeHatch(state, {dispatchInFlight: true})).toBe(true);
	});

	it('keeps the burner silent, which has nothing to confirm', () => {
		expect(
			shouldPromptForWalletAction(
				{
					step: 'WalletConnected',
					mechanism: {type: 'wallet', name: 'Burner Wallet'},
				},
				new Set(),
				{dispatchInFlight: true},
			),
		).toBe(false);
	});

	it('does NOT prompt for a dispatch nobody was asked about', () => {
		// The modal says "Wallet Action Required". Raising it for a transaction the
		// app signed with a key it holds itself is a false instruction: no wallet
		// asked anything, nothing is waiting on the user, and there is nothing for
		// them to go and do. Observed on a branch with a local signer, where every
		// commit and a self-submitted registration flashed the modal, several times
		// a minute in a game with a short round loop, too briefly to read.
		//
		// The counts differ because a local signer's dispatch IS outstanding (it is
		// awaited, it arms the unload guard, it lights the sending indicator) and is
		// simply not a request to a human. A count of dispatches cannot tell the two
		// apart, which is why `guardDispatch` records it per dispatch instead.
		expect(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set(), {
				dispatchInFlight: true,
				promptingDispatchInFlight: false,
			}),
		).toBe(false);

		// Guards the guard: same state, same call, a wallet doing the signing. If
		// this ever goes false the silence above has stopped being a distinction and
		// become the locked-Rabby bug again.
		expect(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set(), {
				dispatchInFlight: true,
				promptingDispatchInFlight: true,
			}),
		).toBe(true);
	});

	it('STILL offers the escape hatch for a silent dispatch', () => {
		// Only the instruction is narrowed. Everything that protects the
		// transaction stays broad, or suppressing a modal would start losing
		// transactions, which is a far worse bug than the one being fixed.
		const silent = {dispatchInFlight: true, promptingDispatchInFlight: false};
		expect(offersEscapeHatch({step: 'WalletConnected'}, silent)).toBe(true);
		expect(outstandingRequestKind({step: 'WalletConnected'}, silent)).toBe(
			'transaction',
		);
	});

	it('does not tell the user their WALLET has a transaction it never saw', () => {
		// The same untruth as the modal, one click further in, and in the place this
		// module calls the feature. Suppressing "Wallet Action Required" and then
		// opening a dialog that says "your wallet still has this transaction ... if
		// you approve it later" would have moved the lie rather than removed it.
		const copy = escapeHatchCopy(
			{step: 'WalletConnected'},
			{dispatchInFlight: true, promptingDispatchInFlight: false},
		);
		expect(copy.title).toBe('This app is still sending a transaction');
		expect(copy.body).not.toContain('approve it later');
		expect(copy.body).toContain('nothing for you to approve');
		// The promises the wording must keep, whatever the case: no implication
		// that this takes anything back, and the same two buttons.
		expect(`${copy.title} ${copy.body}`.toLowerCase()).not.toContain('cancel');
		expect(copy.body).toContain('cannot be taken back');
		expect(copy.trigger).toBe('Stop waiting');
		expect(copy.dismiss).toBe('Keep waiting');
	});

	it('lets the wallet speak when it IS holding something', () => {
		// A silent dispatch speaks only for itself. With a real request in the
		// list, the words are the wallet's, because the user does have something to
		// go and answer.
		const silent = {dispatchInFlight: true, promptingDispatchInFlight: false};
		expect(
			escapeHatchCopy(
				{wallet: {pendingRequests: [{kind: 'transaction'}]}},
				silent,
			).title,
		).toContain('still has this transaction');

		// And a SIGNATURE keeps its own words instead of being outranked into
		// transaction wording by a send nobody was asked about. Rare before a local
		// signer existed, ordinary once one does.
		expect(
			escapeHatchCopy(
				{wallet: {pendingRequests: [{kind: 'signature'}]}},
				silent,
			).title,
		).toContain('signature request');
	});

	it('still speaks for the wallet when the dispatch IS a wallet dispatch', () => {
		// Guards the guard: the silent branch must not swallow the case it was
		// carved out of, which is the library losing track of a real request.
		const copy = escapeHatchCopy(
			{step: 'WalletConnected'},
			{dispatchInFlight: true, promptingDispatchInFlight: true},
		);
		expect(copy.title).toContain('still has this transaction');
	});

	it('assumes a dispatch prompts when nobody has said otherwise', () => {
		// The default that keeps every existing caller correct: an app that knows
		// nothing of silent signers passes `dispatchInFlight` alone and keeps
		// today's behaviour, rather than silently losing the modal for a real
		// wallet, which is the failure that would be discovered in production.
		expect(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set(), {
				dispatchInFlight: true,
			}),
		).toBe(true);
	});

	it('goes quiet again once the user stops waiting', () => {
		// stopWaitingForWallet clears the app's live dispatches as well as the
		// library's request ids, so both sources fall silent together and the
		// modal does not come straight back.
		expect(
			shouldPromptForWalletAction(
				{step: 'WalletConnected', wallet: {pendingRequests: [{id: 'r1'}]}},
				new Set(['r1']),
				{dispatchInFlight: false},
			),
		).toBe(false);
	});
});

describe('stopping waiting when the LIBRARY has lost the request', () => {
	// The state that motivated `dispatchInFlight` in the first place: a wallet
	// state rebuild resets `pendingRequests` to [] while the transaction is
	// genuinely outstanding. The modal and the escape hatch both appear on the
	// strength of the app's own dispatch, so confirming must be judged the same
	// way. Reading only `pendingRequests` here reintroduced the disconnect bug
	// through the very path added to fix the modal.
	const lostRequest = {step: 'WalletConnected'} as const;

	function spies() {
		const calls: string[] = [];
		return {
			calls,
			connection: {cancel: () => calls.push('cancel')},
			inFlight: {
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => calls.push('stopAwaiting'),
			},
		};
	}

	it('does NOT cancel the connection when the app is still dispatching', async () => {
		const {calls, connection, inFlight} = spies();

		const outcome = await stopWaitingForWallet(
			lostRequest,
			connection,
			inFlight,
			() => calls.push('release'),
			{dispatchInFlight: true},
		);

		expect(outcome).toBe('released-prompt');
		expect(calls).not.toContain('cancel');
	});

	it('still says the transaction words when only the app knows', async () => {
		// Otherwise the user is shown the generic "stop waiting for your wallet?"
		// copy about a transaction that can move funds.
		const copy = escapeHatchCopy(lostRequest, {dispatchInFlight: true});
		expect(copy.title).toContain('still has this transaction');
		expect(copy.body).toContain('it will still be sent');
	});

	it('cancels only when nothing is dispatching and nothing is held', async () => {
		const {calls, connection, inFlight} = spies();
		await stopWaitingForWallet(
			{step: 'WaitingForSignature'},
			connection,
			inFlight,
			() => calls.push('release'),
			{dispatchInFlight: false},
		);
		expect(calls).toContain('cancel');
	});
});

describe('createWalletActivity: one answer, so consumers cannot drift', () => {
	// The bug this store exists to make unwriteable: the escape hatch appeared on
	// the strength of the app's own dispatch, then the code behind it consulted
	// only the library's (empty) request list, concluded nothing was outstanding,
	// and cancelled the connection with a transaction in flight.
	function setup(
		initial: {
			connection?: unknown;
			dispatching?: number;
			/** Defaults to `dispatching`: these stories are all wallet sends. */
			prompting?: number;
		} = {},
	) {
		const calls: string[] = [];
		const connection = writable(
			initial.connection ?? {step: 'WalletConnected'},
		);
		const dispatching = initial.dispatching ?? 0;
		const inFlight = writable({
			dispatching,
			prompting: initial.prompting ?? dispatching,
		});
		const activity = createWalletActivity({
			connection: connection as never,
			inFlight: {
				subscribe: inFlight.subscribe,
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => {
					calls.push('stopAwaiting');
					// LIKE THE REAL LEDGER, which clears its dispatched set and commits, so
					// `dispatching` is 0 the moment this returns. `stopWaitingForWallet`
					// calls it as its FIRST statement, so the transaction branch survives
					// only because JS evaluates arguments before the call. A fake that
					// leaves the count alone would let a refactor move that read inside
					// the body and silently flip the branch to connection.cancel(), with
					// the whole suite still passing.
					inFlight.set({dispatching: 0, prompting: 0});
				},
			} as never,
			cancelConnection: () => calls.push('cancel'),
		});
		return {activity, connection, inFlight, calls};
	}

	it('says the wallet holds a transaction when only the app knows', () => {
		const {activity} = setup({dispatching: 1});
		const value = get(activity);
		expect(value.promptUser).toBe(true);
		expect(value.escapable).toBe(true);
		expect(value.escapeCopy.title).toContain('still has this transaction');
	});

	it('acts on the SAME answer it displayed', () => {
		// The whole point: whatever made the exit appear is what decides what the
		// exit does. Reading a narrower source here is what cancelled connections.
		const {activity, calls} = setup({dispatching: 1});
		expect(get(activity).escapable).toBe(true);

		return activity.stopWaiting().then((outcome) => {
			expect(outcome).toBe('released-prompt');
			expect(calls).not.toContain('cancel');
		});
	});

	it('cancels the flow when nothing is dispatching and nothing is held', async () => {
		const {activity, calls} = setup({
			connection: {step: 'WaitingForSignature'},
		});
		expect(get(activity).escapable).toBe(true);

		const outcome = await activity.stopWaiting();
		expect(outcome).toBe('cancelled-connection');
		expect(calls).toEqual(['stopAwaiting', 'cancel', 'reconcile']);
	});

	it('goes quiet after stopping, and speaks again for the NEXT request', async () => {
		const {activity, connection, inFlight} = setup({
			connection: {
				step: 'WalletConnected',
				wallet: {pendingRequests: [{id: 'r1', kind: 'transaction'}]},
			},
			dispatching: 1,
		});
		expect(get(activity).promptUser).toBe(true);

		await activity.stopWaiting();
		inFlight.set({dispatching: 0, prompting: 0});
		expect(get(activity).promptUser).toBe(false);

		// A different request must not inherit that silence.
		connection.set({
			step: 'WalletConnected',
			wallet: {pendingRequests: [{id: 'r2', kind: 'transaction'}]},
		});
		expect(get(activity).promptUser).toBe(true);
	});

	it('tracks the connection as it changes', () => {
		const {activity, connection} = setup();
		expect(get(activity).escapable).toBe(false);

		connection.set({
			step: 'WalletConnected',
			wallet: {pendingRequests: [{id: 'r1', kind: 'signature'}]},
		});
		expect(get(activity).escapable).toBe(true);
		// The kind still reaches the user, through the words rather than a field
		// nothing reads: see the note on WalletActivity about adding one.
		expect(get(activity).escapeCopy.title).toContain('signature request');
	});
});

describe('createWalletActivity: the action must not depend on being watched', () => {
	// `derived` does not run its callback until something subscribes, so state
	// captured inside the derivation is absent until then. An action that reads
	// that captured state answers from `{}` on an unsubscribed store, which for
	// this one means "nothing is outstanding" and therefore CANCEL THE
	// CONNECTION: the disconnect-and-lose-the-transaction branch, chosen because
	// nobody was rendering. Every other test here calls `get()` first, and `get()`
	// subscribes transiently, which is what hid this.
	it('does not cancel the connection just because nothing subscribed', async () => {
		const calls: string[] = [];
		const activity = createWalletActivity({
			connection: writable({step: 'WalletConnected'}) as never,
			inFlight: {
				subscribe: writable({dispatching: 1, prompting: 1}).subscribe,
				reconcile: async () => {
					calls.push('reconcile');
				},
				stopAwaiting: () => calls.push('stopAwaiting'),
			} as never,
			cancelConnection: () => calls.push('cancel'),
		});

		// Deliberately NO `get(activity)` before this.
		const outcome = await activity.stopWaiting();

		expect(outcome).toBe('released-prompt');
		expect(calls).not.toContain('cancel');
	});
});

describe('createWalletActivity: dismissal is the fifth consumer', () => {
	// `canDismissConnection` reads `pendingRequests` and nothing else, and the
	// modals wire it to `onCancel`, which is `connection.cancel()`. So in exactly
	// the state this module exists for (a wallet state rebuild empties the list
	// while a dispatch is outstanding) a stray click outside the Network Switch
	// modal disconnects with a transaction in flight, bypassing stopAwaiting()
	// and the stopped-waiting bookkeeping entirely. Same bug as the escape hatch
	// had, reached by a different door.
	function activityFor(
		dispatching: number,
		connection: unknown,
		prompting = dispatching,
	) {
		return createWalletActivity({
			connection: writable(connection) as never,
			inFlight: {
				subscribe: writable({dispatching, prompting}).subscribe,
				reconcile: async () => {},
				stopAwaiting: () => {},
			} as never,
			cancelConnection: () => {},
		});
	}

	it('refuses a stray-click dismissal while the app is dispatching', () => {
		const state = {step: 'WalletConnected'} as const;
		// The library has lost the request, so the old predicate says "go ahead".
		expect(canDismissConnection(state)).toBe(true);

		expect(get(activityFor(1, state)).dismissable).toBe(false);
	});

	it('refuses it for a SILENT dispatch too, which raises no modal', () => {
		// The prompt is narrowed to dispatches a human was asked about; this is not.
		// A stray click that tears the connection down mid-dispatch loses the
		// transaction whoever signed it, and a local signer's send is no less real
		// for being quiet.
		const state = {step: 'WalletConnected'} as const;
		const value = get(activityFor(1, state, 0));
		expect(value.promptUser).toBe(false);
		expect(value.dismissable).toBe(false);
	});

	it('still allows dismissal when nothing is outstanding', () => {
		expect(get(activityFor(0, {step: 'WalletToChoose'})).dismissable).toBe(
			true,
		);
	});

	it('still refuses it on the steps that always refused', () => {
		expect(
			get(activityFor(0, {step: 'WaitingForWalletConnection'})).dismissable,
		).toBe(false);
	});

	it('never offers dismissal and an escape hatch at the same time', () => {
		// They are opposites: one exit lies about what it does, the other does not.
		for (const [dispatching, state] of [
			[1, {step: 'WalletConnected'}],
			[0, {step: 'WaitingForSignature'}],
			[0, {step: 'WalletToChoose'}],
			[
				0,
				{
					step: 'WalletConnected',
					wallet: {pendingRequests: [{id: 'r', kind: 'transaction'}]},
				},
			],
		] as const) {
			const value = get(activityFor(dispatching, state));
			expect(
				value.dismissable && value.escapable,
				JSON.stringify({dispatching, state}),
			).toBe(false);
		}
	});
});
