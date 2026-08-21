import {describe, it, expect} from 'vitest';
import {
	isBurnerWalletInSelectionPhase,
	hasPendingWalletRequest,
	walletEntryMode,
	resolveSignInAddress,
	hasSwappedAccount,
	signInAdoptingSwap,
	signInToAccount,
	combinesAccountChoiceWithSignIn,
	effectiveAccountSelection,
	canDismissConnection,
	offersEscapeHatch,
	outstandingRequestKind,
	escapeHatchCopy,
	stopWaitingForWallet,
	shouldPromptForWalletAction,
	pendingRequestIds,
} from '../../../../src/lib/core/connection/connection-flow';

const wallet = (name: string) => ({info: {name, icon: ''}});
const addr = (n: number) =>
	`0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;

describe('isBurnerWalletInSelectionPhase', () => {
	it('is true for an active burner wallet mechanism', () => {
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
			}),
		).toBe(true);
	});

	it('is false in Idle / MechanismToChoose or non-burner wallets', () => {
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'Idle',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
			}),
		).toBe(false);
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'MechanismToChoose',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
			}),
		).toBe(false);
		expect(
			isBurnerWalletInSelectionPhase({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
			}),
		).toBe(false);
	});
});

describe('hasPendingWalletRequest', () => {
	it('is true when there are pending requests and not in burner selection', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
				wallet: {pendingRequests: [{}]},
			}),
		).toBe(true);
	});

	it('is false when there are no pending requests', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				wallet: {pendingRequests: []},
			}),
		).toBe(false);
	});

	it('is suppressed during the burner selection phase', () => {
		expect(
			hasPendingWalletRequest({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
				wallet: {pendingRequests: [{}]},
			}),
		).toBe(false);
	});
});

describe('walletEntryMode', () => {
	it('is none with no wallets (regardless of other options)', () => {
		expect(walletEntryMode([], false)).toBe('none');
		expect(walletEntryMode([], true)).toBe('none');
	});
	it('is single with exactly one wallet (regardless of other options)', () => {
		expect(walletEntryMode([wallet('MetaMask')], false)).toBe('single');
		expect(walletEntryMode([wallet('MetaMask')], true)).toBe('single');
	});
	it('shows the list directly when wallets are the only option', () => {
		expect(walletEntryMode([wallet('MetaMask'), wallet('Rabby')], false)).toBe(
			'list',
		);
	});
	it('collapses behind a button when sharing the modal with other options', () => {
		expect(walletEntryMode([wallet('MetaMask'), wallet('Rabby')], true)).toBe(
			'collapsed',
		);
	});
});

describe('resolveSignInAddress', () => {
	it('uses the connected account when no swap happened', () => {
		expect(
			resolveSignInAddress({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
				wallet: {},
			}),
		).toBe(addr(1));
	});

	it('prefers the swapped-to account over the stale mechanism address', () => {
		expect(
			resolveSignInAddress({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
				wallet: {accountChanged: addr(2)},
			}),
		).toBe(addr(2));
	});

	it('is undefined when neither is available', () => {
		expect(resolveSignInAddress({step: 'WalletToChoose'})).toBeUndefined();
	});
});

describe('hasSwappedAccount', () => {
	it('is true when accountChanged is set', () => {
		expect(
			hasSwappedAccount({
				step: 'WalletConnected',
				wallet: {accountChanged: addr(2)},
			}),
		).toBe(true);
	});
	it('is false when accountChanged is absent', () => {
		expect(hasSwappedAccount({step: 'WalletConnected', wallet: {}})).toBe(
			false,
		);
	});
});

describe('combinesAccountChoiceWithSignIn', () => {
	it('combines under a sign-in target', () => {
		expect(combinesAccountChoiceWithSignIn({targetStep: 'SignedIn'})).toBe(
			true,
		);
	});
	it('keeps the plain picker for wallet-only auth', () => {
		expect(
			combinesAccountChoiceWithSignIn({targetStep: 'WalletConnected'}),
		).toBe(false);
	});
});

describe('effectiveAccountSelection', () => {
	const accounts = [addr(1), addr(2), addr(3)];

	it("follows the wallet's active account (first) when the user has not picked", () => {
		expect(effectiveAccountSelection(accounts, undefined)).toBe(addr(1));
	});

	it('honours an explicit user choice', () => {
		expect(effectiveAccountSelection(accounts, addr(3))).toBe(addr(3));
	});

	it('matches the user choice case-insensitively', () => {
		const upper = addr(2).toUpperCase().replace('0X', '0x') as `0x${string}`;
		expect(effectiveAccountSelection(accounts, upper)).toBe(upper);
	});

	it('falls back to the active account when the choice left the list', () => {
		expect(effectiveAccountSelection([addr(1), addr(3)], addr(2))).toBe(
			addr(1),
		);
	});

	it('is undefined with no accounts', () => {
		expect(effectiveAccountSelection([], undefined)).toBeUndefined();
	});
});

describe('signInToAccount', () => {
	function makeStore(initial: any) {
		let value = initial;
		const subs = new Set<(v: any) => void>();
		const set = (v: any) => {
			value = v;
			for (const s of subs) s(value);
		};
		return {
			set,
			get: () => value,
			subscribe(run: (v: any) => void) {
				subs.add(run);
				run(value);
				return () => subs.delete(run);
			},
		};
	}

	it('adopts the account, waits for it to settle, then signs', async () => {
		const store = makeStore({
			step: 'ChooseWalletAccount',
			wallet: {accounts: [addr(1), addr(2)]},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: (address: `0x${string}`) => {
				calls.push(`connectToAddress:${address}`);
				store.set({
					step: 'WalletConnected',
					mechanism: {type: 'wallet', name: 'MetaMask', address},
					wallet: {},
				});
			},
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await signInToAccount(connection as never, addr(2));

		expect(calls).toEqual([`connectToAddress:${addr(2)}`, 'requestSignature']);
	});

	it('rejects (and does not sign) if the flow is cancelled while adopting', async () => {
		const store = makeStore({
			step: 'ChooseWalletAccount',
			wallet: {accounts: [addr(1), addr(2)]},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: () => {
				store.set({step: 'Idle'});
			},
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await expect(signInToAccount(connection as never, addr(2))).rejects.toThrow(
			/cancelled/,
		);
		expect(calls).toEqual([]);
	});
});

describe('signInAdoptingSwap', () => {
	// A tiny writable-store stand-in exposing only the surface the action uses.
	function makeStore(initial: any) {
		let value = initial;
		const subs = new Set<(v: any) => void>();
		const set = (v: any) => {
			value = v;
			for (const s of subs) s(value);
		};
		return {
			set,
			get: () => value,
			subscribe(run: (v: any) => void) {
				subs.add(run);
				run(value);
				return () => subs.delete(run);
			},
		};
	}

	it('signs directly when there was no swap', async () => {
		const store = makeStore({
			step: 'WalletConnected',
			mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
			wallet: {},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: () => calls.push('connectToAddress'),
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await signInAdoptingSwap(connection as never);

		expect(calls).toEqual(['requestSignature']);
	});

	it('adopts the swapped account then signs in one action', async () => {
		const store = makeStore({
			step: 'WalletConnected',
			mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
			wallet: {accountChanged: addr(2)},
		});
		const calls: string[] = [];
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: (address: `0x${string}`) => {
				calls.push('connectToAddress');
				// Simulate the store settling on the adopted account.
				store.set({
					step: 'WalletConnected',
					mechanism: {type: 'wallet', name: 'MetaMask', address},
					wallet: {},
				});
			},
			requestSignature: async () => {
				calls.push('requestSignature');
			},
		};

		await signInAdoptingSwap(connection as never);

		expect(calls).toEqual(['connectToAddress', 'requestSignature']);
		expect(store.get().mechanism.address).toBe(addr(2));
	});

	it('rejects if the flow is cancelled while adopting', async () => {
		const store = makeStore({
			step: 'WalletConnected',
			mechanism: {type: 'wallet', name: 'MetaMask', address: addr(1)},
			wallet: {accountChanged: addr(2)},
		});
		const connection = {
			subscribe: store.subscribe,
			connectToAddress: () => {
				store.set({step: 'Idle'});
			},
			requestSignature: async () => {},
		};

		await expect(signInAdoptingSwap(connection as never)).rejects.toThrow(
			/cancelled/,
		);
	});
});

describe('canDismissConnection: not losing a flow to a stray click', () => {
	// A wallet opens in its own window and takes the focus, so the first click
	// back on the page lands outside whatever dialog is up - which a dialog reads
	// as "close me". Cancelling there throws away a request the user has already
	// started answering, and the only symptom is that the flow silently stops.
	it('refuses a dismissal while the wallet is being waited on', () => {
		for (const step of [
			'WaitingForWalletConnection',
			'WaitingForSignature',
			'PopupLaunched',
		] as const) {
			expect(canDismissConnection({step}), step).toBe(false);
		}
	});

	it('refuses one while a wallet request is pending', () => {
		expect(
			canDismissConnection({
				step: 'WalletConnected',
				mechanism: {type: 'wallet', name: 'MetaMask'},
				wallet: {pendingRequests: [{}]},
			}),
		).toBe(false);
	});

	it('allows one while a burner wallet is still being selected', () => {
		// hasPendingWalletRequest suppresses itself during the burner selection
		// phase, so a pending request there does not freeze the flow. Nothing is
		// waiting on a human in another window, so there is nothing to protect.
		expect(
			canDismissConnection({
				step: 'WalletToChoose',
				mechanism: {type: 'wallet', name: 'Burner Wallet'},
				wallet: {pendingRequests: [{}]},
			}),
		).toBe(true);
	});

	it('allows one on the steps that are simply waiting for the user', () => {
		// Choosing a wallet, choosing an account, confirming a sign-in: nothing is
		// in flight, so clicking away means what it says.
		for (const step of [
			'WalletToChoose',
			'MechanismToChoose',
			'ChooseWalletAccount',
			'WalletConnected',
		] as const) {
			expect(canDismissConnection({step}), step).toBe(true);
		}
	});
});

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
