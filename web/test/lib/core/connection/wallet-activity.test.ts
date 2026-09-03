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
	walletPromptCopy,
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
				pendingRequests: [{kind: 'transaction'}],
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
				pendingRequests: [{kind: 'signature'}, {kind: 'transaction'}],
			}),
		).toBe('transaction');
	});

	it('reports no outstanding kind when the wallet holds nothing', () => {
		expect(outstandingRequestKind({step: 'WaitingForWalletConnection'})).toBe(
			undefined,
		);
		expect(outstandingRequestKind({pendingRequests: []})).toBe(undefined);
	});

	it('never offers to cancel, undo, or take back', () => {
		// "Cancel" would imply the app can undo what the wallet already has, which
		// is precisely the thing it cannot do.
		const states = [
			{step: 'WaitingForWalletConnection'},
			{pendingRequests: [{kind: 'transaction'}]},
			{pendingRequests: [{kind: 'signature'}]},
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
			pendingRequests: [{kind: 'transaction'}],
		});
		expect(transaction.title).toContain('still has this transaction');
		expect(transaction.body).toContain('it will still be sent');

		const signature = escapeHatchCopy({
			pendingRequests: [{kind: 'signature'}],
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
				pendingRequests: [{kind: 'transaction', id: 'req_1'}],
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
			{pendingRequests: [{kind: 'transaction', id: 'req_1'}]},
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
			{pendingRequests: [{kind: 'transaction', id: 'req_1'}]},
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
	const request = (
		id: string,
		kind: 'transaction' | 'signature' = 'transaction',
	) => ({id, kind});

	it('prompts while the wallet holds something nobody gave up on', () => {
		expect(
			shouldPromptForWalletAction(
				{step: 'WalletConnected', pendingRequests: [request('a')]},
				new Set(),
			),
		).toBe(true);
	});

	it('stops prompting for a request the user gave up on', () => {
		expect(
			shouldPromptForWalletAction(
				{step: 'WalletConnected', pendingRequests: [request('a')]},
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
				{step: 'WalletConnected', pendingRequests: [request('b')]},
				new Set(['a']),
			),
		).toBe(true);
	});

	it('prompts when only some of several are given up on', () => {
		expect(
			shouldPromptForWalletAction(
				{
					step: 'WalletConnected',
					pendingRequests: [request('a'), request('b')],
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
					pendingRequests: [{kind: 'transaction'}],
				},
				new Set(['a']),
			),
		).toBe(true);
	});

	it('says nothing when the wallet holds nothing, and keeps the burner silent', () => {
		expect(shouldPromptForWalletAction({pendingRequests: []}, new Set())).toBe(
			false,
		);
		expect(
			shouldPromptForWalletAction(
				{
					step: 'WalletConnected',
					mechanism: {type: 'wallet', name: 'Burner Wallet'},
					pendingRequests: [request('a')],
				},
				new Set(),
			),
		).toBe(false);
	});

	it('reads the ids the wallet is holding', () => {
		expect(
			pendingRequestIds({
				// The third has no id, which is a request that cannot be given up on
				// individually rather than a malformed one.
				pendingRequests: [request('a'), request('b'), {kind: 'transaction'}],
			}),
		).toEqual(['a', 'b']);
		expect(pendingRequestIds({step: 'Idle'})).toEqual([]);
	});
});

describe("the app's own dispatch, which answers a different question", () => {
	// WHY THIS LEDGER STILL EXISTS, since the reason it was BUILT has expired.
	//
	// It was built for a locked-Rabby report: no modal appeared for a transaction
	// being sent, because every wallet-state rebuild in @etherplay/connect asserted
	// `pendingRequests: []` and erased the outstanding request permanently.
	// 0.10.0 copies the live list at each rebuild instead, so that is fixed at the
	// source and the e2e suite now drives the transition that caused it
	// (e2e/tests/escape-hatch.e2e.ts, "survives a reconnect").
	//
	// What these tests now pin is the part no upstream fix reaches: a send signed
	// by a key the app holds itself is not a wallet request and can never appear in
	// a list of them, and the app starts waiting a beat before the wallet is handed
	// anything. See ADR-0008 on the `work` branch.
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
		// reports nothing, which for a locally-signed send it always will.
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
			escapeHatchCopy({pendingRequests: [{kind: 'transaction'}]}, silent).title,
		).toContain('still has this transaction');

		// And a SIGNATURE keeps its own words instead of being outranked into
		// transaction wording by a send nobody was asked about. Rare before a local
		// signer existed, ordinary once one does.
		expect(
			escapeHatchCopy({pendingRequests: [{kind: 'signature'}]}, silent).title,
		).toContain('signature request');
	});

	it('still speaks for the wallet when the dispatch IS a wallet dispatch', () => {
		// Guards the guard: the silent branch must not swallow the case it was
		// carved out of, which is a real request the app is waiting on.
		const copy = escapeHatchCopy(
			{step: 'WalletConnected'},
			{dispatchInFlight: true, promptingDispatchInFlight: true},
		);
		expect(copy.title).toContain('still has this transaction');
	});

	it('does not let a visible signature outrank a silent transaction', () => {
		// THE PRECEDENCE THE 0.10.0 FIX MADE MORE IMPORTANT, not less.
		//
		// `outstandingRequestKind` decides whether stopping waiting may cancel the
		// connection, and cancelling with a transaction in flight is the
		// disconnect-and-lose-the-transaction bug. A send the app signed ITSELF is
		// invisible to `pendingRequests` by construction, so if the library's list
		// were read first, a delegation signature sitting in it would answer
		// 'signature' and take the cancelling branch.
		//
		// That pairing used to be near-hypothetical and is now ordinary: the same
		// release routed `getDelegation` and `getSignatureForPublicKeyPublication`
		// through the wrapper, so library signatures are announced where before they
		// opened a wallet with nothing behind them.
		const state = {
			step: 'WalletConnected',
			pendingRequests: [
				{id: 'sig', kind: 'signature' as const, purpose: 'delegation'},
			],
		} as const;
		expect(outstandingRequestKind(state)).toBe('signature');
		expect(
			outstandingRequestKind(state, {
				dispatchInFlight: true,
				promptingDispatchInFlight: false,
			}),
		).toBe('transaction');
	});
});

describe('walletPromptCopy: saying WHAT the wallet is asking', () => {
	// Three sentences @etherplay/connect 0.10.0 made available that were not
	// before: what a library-originated request is FOR (`purpose`), WHO is
	// expected to answer it (`account`), and the honest reading of an empty list,
	// which used to be ambiguous between "not asked yet" and "asked, then erased".
	const connected = '0x1111111111111111111111111111111111111111' as const;
	const other = '0x2222222222222222222222222222222222222222' as const;
	const asConnected = {
		step: 'WalletConnected' as const,
		mechanism: {type: 'wallet', name: 'Rabby', address: connected},
	};

	it('names a delegation, which is the request worth naming', () => {
		// A delegation grants a browser key authority to act for the account. An
		// unexplained request for exactly that is the shape a phishing prompt takes,
		// so a user who cannot tell them apart is right to distrust both.
		const copy = walletPromptCopy(
			{
				...asConnected,
				pendingRequests: [{id: 'a', kind: 'signature', purpose: 'delegation'}],
			},
			new Set(),
		);
		expect(copy.title).toContain('delegation');
		expect(copy.body).toContain('send transactions for your account');
		// It must not imply anything is spent, because nothing is.
		expect(copy.body).toContain('Nothing is spent');
	});

	it('names a public-key publication', () => {
		const copy = walletPromptCopy(
			{
				...asConnected,
				pendingRequests: [
					{id: 'a', kind: 'signature', purpose: 'public-key-publication'},
				],
			},
			new Set(),
		);
		expect(copy.title).toContain('public key');
	});

	it('falls back to the kind for a purpose it has never heard of', () => {
		// The union is expected to grow. An unrecognised purpose is a request the
		// user must still be told about, so it degrades to the kind rather than
		// throwing or going blank. This is also why `purpose` is typed `string` in
		// PendingRequestSnapshot: a new one upstream must not break this build.
		const copy = walletPromptCopy(
			{
				...asConnected,
				pendingRequests: [
					{id: 'a', kind: 'signature', purpose: 'something-invented-later'},
				],
			},
			new Set(),
		);
		expect(copy.title).toContain('signature request');
		expect(copy.body).not.toContain('undefined');
	});

	it('says a transaction is a transaction when nothing named a purpose', () => {
		// Absent `purpose` is the NORMAL case, not a gap: it means the app sent this
		// itself through connection.provider and already knows what it is.
		const copy = walletPromptCopy(
			{
				...asConnected,
				pendingRequests: [{id: 'a', kind: 'transaction'}],
			},
			new Set(),
		);
		expect(copy.title).toContain('transaction');
		expect(copy.body).toContain('will not be sent until you approve it');
	});

	it('tells the user WHICH account a request is waiting on after a switch', () => {
		// A request now survives a wallet-state rebuild, so it can outlive the wallet
		// state it started under, and the user may switch account while one is
		// outstanding. The upstream list is not per-wallet and nothing marks or drops
		// a request when the wallet is swapped underneath it, so this comparison is
		// the only way the case is detectable from here. Without it the modal tells
		// the user to approve in a wallet that cannot answer.
		const copy = walletPromptCopy(
			{
				...asConnected,
				pendingRequests: [{id: 'a', kind: 'transaction', account: other}],
			},
			new Set(),
		);
		expect(copy.title).toContain('different account');
		expect(copy.body).toContain('0x2222…2222');
		expect(copy.body).toContain('0x1111…1111');
		// It must not lose the escape hatch's promise on the way.
		expect(copy.body).toContain('approved later it still acts');
	});

	it('follows a swapped account rather than the stale connected one', () => {
		// `wallet.accountChanged` is where a live swap surfaces; `mechanism.address`
		// stays stale. Comparing against the stale one would report a mismatch for a
		// request the user's CURRENT account is holding perfectly well.
		const copy = walletPromptCopy(
			{
				...asConnected,
				wallet: {accountChanged: other},
				pendingRequests: [{id: 'a', kind: 'transaction', account: other}],
			},
			new Set(),
		);
		expect(copy.title).not.toContain('different account');
	});

	it('never guesses a mismatch from a missing address', () => {
		// `account` is optional upstream and `mechanism.address` is absent on some
		// steps. Reading either absence as a mismatch would send the user hunting
		// through wallets for a request the one in front of them is holding.
		expect(
			walletPromptCopy(
				{
					...asConnected,
					pendingRequests: [{id: 'a', kind: 'transaction'}],
				},
				new Set(),
			).title,
		).not.toContain('different account');
		expect(
			walletPromptCopy(
				{
					step: 'WalletConnected',
					pendingRequests: [{id: 'a', kind: 'transaction', account: other}],
				},
				new Set(),
			).title,
		).not.toContain('different account');
	});

	it('does not tell a LOCKED wallet owner to go and approve something', () => {
		// The most literal false instruction available: the request is real, the
		// wallet has it, and a locked wallet does not show it. Measured before this
		// existed: with a transaction parked and the wallet locked, the modal said
		// "Confirm the transaction in your wallet" and the whole page offered no
		// Unlock, no Connect and no hint anything was wrong.
		const locked = {
			...asConnected,
			wallet: {status: 'locked' as const, unlocking: false},
			pendingRequests: [{id: 'a', kind: 'transaction' as const}],
		};
		const copy = walletPromptCopy(locked, new Set());
		expect(copy.title).toBe('Your wallet is locked');
		expect(copy.body).toContain('Unlock it');
		// And it must not imply the app gave up on the request while they were away.
		expect(copy.body).toContain('still there waiting');

		// Checked BEFORE what the request is, because it changes what the user must
		// DO and everything else only changes what it is called.
		expect(
			walletPromptCopy(
				{
					...locked,
					pendingRequests: [
						{id: 'a', kind: 'signature', purpose: 'delegation'},
					],
				},
				new Set(),
			).title,
		).toBe('Your wallet is locked');
	});

	it('stops repeating itself once the wallet is asking for the password', () => {
		// `unlocking` is the wallet's own prompt being up. Saying "your wallet is
		// locked" at that moment reads as the app not having noticed, and offering
		// Unlock again invites a click that does nothing visible.
		const unlocking = {
			...asConnected,
			wallet: {status: 'locked' as const, unlocking: true},
			pendingRequests: [{id: 'a', kind: 'transaction' as const}],
		};
		expect(walletPromptCopy(unlocking, new Set()).title).toBe(
			'Waiting for your wallet to unlock',
		);
	});

	it('does not claim the wallet is asking before it has been asked', () => {
		// THE DEMOTION. The ledger term in shouldPromptForWalletAction still raises
		// the modal a beat before the wallet has anything, because viem reads a chain
		// id, a nonce and a gas estimate through the same provider first. Saying
		// "confirm the request in your wallet" there is the four-second falsehood
		// in-flight-store already moved this counter once to avoid.
		//
		// Only tellable because an empty list is now unambiguous. Before 0.10.0 it
		// meant either this or "asked, then erased", so the loud wording had to cover
		// both.
		const copy = walletPromptCopy({step: 'WalletConnected'}, new Set(), {
			dispatchInFlight: true,
			promptingDispatchInFlight: true,
		});
		expect(copy.title).toBe('Getting your transaction ready');
		// True under the other reading too, which this app cannot rule out: if the
		// wallet HAS already been asked, the sentence still tells the user what to do.
		expect(copy.body).toContain('if it has already asked, approve it there');
		// And it is still a block with an exit behind it: only the claim was dropped.
		expect(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set(), {
				dispatchInFlight: true,
				promptingDispatchInFlight: true,
			}),
		).toBe(true);
	});

	it('describes the transaction rather than a signature beside it', () => {
		// Same rule as outstandingRequestKind: with both outstanding, the sentence is
		// about the one that can spend money.
		const copy = walletPromptCopy(
			{
				...asConnected,
				pendingRequests: [
					{id: 'a', kind: 'signature', purpose: 'delegation'},
					{id: 'b', kind: 'transaction'},
				],
			},
			new Set(),
		);
		expect(copy.title).toContain('transaction');
	});

	it('does not describe a request the user has given up on', () => {
		// The modal is up for the newer send, so the words have to be about that one.
		// It reads the SAME stopped-waiting set the decision to prompt was made with,
		// which is what keeps the two from describing different moments.
		const copy = walletPromptCopy(
			{
				...asConnected,
				pendingRequests: [
					{id: 'abandoned', kind: 'transaction', account: other},
				],
			},
			new Set(['abandoned']),
			{dispatchInFlight: true, promptingDispatchInFlight: true},
		);
		expect(copy.title).not.toContain('different account');
		expect(copy.title).toBe('Getting your transaction ready');
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
				{step: 'WalletConnected', pendingRequests: [{id: 'r1'}]},
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

	it('hands the modal its words instead of letting it choose them', () => {
		// The boundary rule in action: the component needed a sharper sentence than
		// "Wallet Action Required", and the answer is a field here rather than a
		// component reading `pendingRequests` for itself. Reaching around this is
		// what let five consumers drift far enough apart to cancel a connection with
		// a transaction in flight.
		const {activity} = setup({
			connection: {
				step: 'WalletConnected',
				mechanism: {
					type: 'wallet',
					name: 'Rabby',
					address: '0x1111111111111111111111111111111111111111',
				},
				pendingRequests: [{id: 'a', kind: 'signature', purpose: 'delegation'}],
			},
		});
		const value = get(activity);
		expect(value.promptUser).toBe(true);
		expect(value.promptCopy.title).toContain('delegation');
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
				pendingRequests: [{id: 'r1', kind: 'transaction'}],
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
			pendingRequests: [{id: 'r2', kind: 'transaction'}],
		});
		expect(get(activity).promptUser).toBe(true);
	});

	it('tracks the connection as it changes', () => {
		const {activity, connection} = setup();
		expect(get(activity).escapable).toBe(false);

		connection.set({
			step: 'WalletConnected',
			pendingRequests: [{id: 'r1', kind: 'signature'}],
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
					pendingRequests: [{id: 'r', kind: 'transaction'}],
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
