import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {
	hasUnansweredRequest,
	reconcileWhenAccountArrives,
	reportHeading,
	reportedRequests,
	watchUnresolvedRequests,
} from '../../../../src/lib/core/transaction/in-flight-view';
import {shouldPromptForWalletAction} from '../../../../src/lib/core/connection/connection-flow';
import type {InFlightState} from '../../../../src/lib/core/transaction/in-flight-store';
import type {InFlightRequest} from '../../../../src/lib/core/transaction/in-flight';

const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;

function request(id: string, description: string): InFlightRequest {
	return {
		id,
		account: ACCOUNT,
		chainId: 31337,
		nonce: 3,
		intent: {description},
		requestedAt: 1000,
	};
}

describe('reportedRequests', () => {
	it('says NOTHING about a request that is still in flight', () => {
		// The connection flow already has "Please confirm the request in your
		// wallet" on screen. A second dialog on top of it, about the same request,
		// would be the app contradicting itself while the user is mid-answer.
		const state: InFlightState = {
			requests: [request('a', 'setMessage')],
			outcomes: {},
			dispatching: 0,
		};
		expect(reportedRequests(state)).toEqual([]);
	});

	it('says nothing about a request the app turned out to have recorded', () => {
		const state: InFlightState = {
			requests: [request('a', 'setMessage')],
			outcomes: {a: {status: 'recorded', nonce: 3}},
			dispatching: 0,
		};
		expect(reportedRequests(state)).toEqual([]);
	});

	it('reports a reconciled request with the sentence for its outcome', () => {
		const state: InFlightState = {
			requests: [request('a', 'setMessage')],
			outcomes: {a: {status: 'unknown', reason: 'nonce-free'}},
			dispatching: 0,
		};
		const [reported] = reportedRequests(state);
		expect(reported.id).toBe('a');
		expect(reported.description).toBe('setMessage');
		expect(reported.account).toBe(ACCOUNT);
		expect(reported.message).toContain('still be waiting in your wallet');
	});

	it('keeps the order the user did things in', () => {
		const state: InFlightState = {
			requests: [request('a', 'first'), request('b', 'second')],
			outcomes: {
				a: {status: 'unknown', reason: 'nonce-free'},
				b: {status: 'nonce-consumed', nonce: 4},
			},
			dispatching: 0,
		};
		expect(reportedRequests(state).map((r) => r.description)).toEqual([
			'first',
			'second',
		]);
	});

	it('reports only the reconciled ones when both kinds are present', () => {
		const state: InFlightState = {
			requests: [request('a', 'done being asked'), request('b', 'asking now')],
			outcomes: {a: {status: 'unknown', reason: 'nonce-free'}},
			dispatching: 0,
		};
		expect(reportedRequests(state).map((r) => r.id)).toEqual(['a']);
	});
});

describe('hasUnansweredRequest (what guardUnload watches)', () => {
	it('is true while the app is waiting on a dispatch', () => {
		expect(
			hasUnansweredRequest({
				requests: [request('a', 'setMessage')],
				outcomes: {},
				dispatching: 1,
			}),
		).toBe(true);
	});

	it('is FALSE for records restored from a previous session', () => {
		// They are durable and have already been reported, so losing the page
		// cannot make them worse and warning would be nagging. Nothing is being
		// awaited after a reload, whatever survived.
		expect(
			hasUnansweredRequest({
				requests: [request('a', 'setMessage'), request('b', 'other')],
				outcomes: {a: {status: 'unknown', reason: 'nonce-free'}},
				dispatching: 0,
			}),
		).toBe(false);
	});

	it('agrees with the wallet modal, because it is the same fact', () => {
		// Reported: a modal for a request, and no prompt when reloading. The three
		// things that should agree (modal, escape hatch, unload guard) were each
		// asking a different question. They now all rest on `dispatching`.
		const awaiting = {
			requests: [request('a', 'x')],
			outcomes: {},
			dispatching: 1,
		};
		expect(hasUnansweredRequest(awaiting)).toBe(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set(), {
				dispatchInFlight: awaiting.dispatching > 0,
			}),
		);
	});

	it('is false with nothing in flight', () => {
		expect(
			hasUnansweredRequest({requests: [], outcomes: {}, dispatching: 0}),
		).toBe(false);
	});
});

describe('reportHeading: the modal must not contradict its own body', () => {
	const reported = (outcome: any) => ({
		id: 'a',
		description: 'setMessage',
		account: ACCOUNT,
		requestedAt: 1,
		outcome,
		message: 'x',
	});

	it('does not hedge about a transaction it watched go out', () => {
		// The body says "This transaction WAS sent (0x...)". A header reading
		// "never answered, so it cannot say whether it went through" makes the app
		// contradict itself in the same dialog.
		const heading = reportHeading([
			reported({status: 'broadcast-not-recorded', hash: '0xabc'}),
		]);
		expect(heading.title).not.toContain('may have been sent');
		expect(heading.lead).not.toContain('never answered');
		expect(heading.lead).toContain('on chain');
		expect(heading.lead).toContain('not the transaction');
	});

	it('hedges when it genuinely does not know', () => {
		const heading = reportHeading([
			reported({status: 'unknown', reason: 'nonce-free'}),
		]);
		expect(heading.title).toContain('may have been sent');
		expect(heading.lead).toContain('never answered');
	});

	it('never says "this transaction", because there is nothing to point at', () => {
		// Reported: after a reload the modal says "This transaction may have been
		// sent" about a request from a session that is over, so "this" points at
		// nothing on screen and reads as though the app has lost track of what it
		// is talking about.
		const headings = [
			reportHeading([reported({status: 'unknown', reason: 'nonce-free'})]),
			reportHeading([
				reported({status: 'broadcast-not-recorded', hash: '0xa'}),
			]),
			reportHeading([
				reported({status: 'unknown', reason: 'nonce-free'}),
				reported({status: 'unknown', reason: 'unreadable'}),
			]),
		];
		for (const heading of headings) {
			expect(heading.title.toLowerCase()).not.toContain('this transaction');
			expect(heading.lead.toLowerCase()).not.toContain('send this');
		}
	});

	it('hedges for a mixed set, because the hedge is true of one of them', () => {
		const heading = reportHeading([
			reported({status: 'broadcast-not-recorded', hash: '0xabc'}),
			reported({status: 'unknown', reason: 'nonce-free'}),
		]);
		expect(heading.title).toContain('may have been sent');
	});

	it('counts, so it never says "this transaction" about three', () => {
		expect(
			reportHeading([
				reported({status: 'unknown', reason: 'nonce-free'}),
				reported({status: 'unknown', reason: 'nonce-free'}),
			]).title,
		).toContain('Some transactions');
		expect(
			reportHeading([
				reported({status: 'broadcast-not-recorded', hash: '0xa'}),
				reported({status: 'broadcast-not-recorded', hash: '0xb'}),
			]).title,
		).toBe('Transactions missing from your list');
	});
});

describe('reconcileWhenAccountArrives', () => {
	// Reported: "on reload, it does not reconcile". It did, once, at startup,
	// which is before the wallet has reconnected and therefore before the app can
	// tell whether it already holds the operation. So the user was told a
	// transaction might have been sent while it sat in their list.
	function ledgerSpy() {
		let passes = 0;
		return {
			ledger: {
				reconcile: async () => {
					passes++;
				},
			},
			passes: () => passes,
		};
	}

	it('reconciles again once an account is known', () => {
		const account = writable<`0x${string}` | undefined>(undefined);
		const {ledger, passes} = ledgerSpy();

		reconcileWhenAccountArrives({account, ledger});
		expect(passes()).toBe(0);

		account.set(ACCOUNT);
		expect(passes()).toBe(1);
	});

	it('reconciles again when the user switches account', () => {
		const account = writable<`0x${string}` | undefined>(ACCOUNT);
		const {ledger, passes} = ledgerSpy();
		reconcileWhenAccountArrives({account, ledger});
		expect(passes()).toBe(1);

		account.set('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
		expect(passes()).toBe(2);
	});

	it('does not loop on a store that re-emits the same account', () => {
		// A reconciliation that triggers on every emission would hammer the node,
		// and the account store emits for reasons of its own.
		const account = writable<`0x${string}` | undefined>(ACCOUNT);
		const {ledger, passes} = ledgerSpy();
		reconcileWhenAccountArrives({account, ledger});

		account.set(ACCOUNT);
		account.set(ACCOUNT);
		expect(passes()).toBe(1);
	});

	it('ignores disconnection, which tells it nothing new', () => {
		const account = writable<`0x${string}` | undefined>(ACCOUNT);
		const {ledger, passes} = ledgerSpy();
		reconcileWhenAccountArrives({account, ledger});

		account.set(undefined);
		expect(passes()).toBe(1);
	});

	it('stops when torn down', () => {
		const account = writable<`0x${string}` | undefined>(undefined);
		const {ledger, passes} = ledgerSpy();
		const stop = reconcileWhenAccountArrives({account, ledger});

		stop();
		account.set(ACCOUNT);
		expect(passes()).toBe(0);
	});
});

describe('watchUnresolvedRequests', () => {
	// Reported from real use: "on reload no reconciliation happens, note that I
	// execute the tx on my wallet AFTER the reload, so maybe the reconciliation
	// only happens once and does not wait?". Exactly so. The notice promises that
	// approving later still sends it, and the app was not watching for that.
	function fakeLedger(initial: InFlightState) {
		const store = writable(initial);
		let passes = 0;
		return {
			ledger: {
				subscribe: store.subscribe,
				reconcile: async () => {
					passes++;
				},
			},
			passes: () => passes,
			set: (s: InFlightState) => store.set(s),
		};
	}

	const watching = (reason: 'nonce-free' | 'unreadable'): InFlightState => ({
		requests: [request('a', 'setMessage')],
		outcomes: {a: {status: 'unknown', reason}},
		dispatching: 0,
	});

	it('keeps asking while the request may still be with the wallet', async () => {
		vi.useFakeTimers();
		try {
			const {ledger, passes} = fakeLedger(watching('nonce-free'));
			const stop = watchUnresolvedRequests({ledger, intervalMs: 1000});

			expect(passes()).toBe(0);
			await vi.advanceTimersByTimeAsync(1000);
			expect(passes()).toBe(1);
			// And again, on a longer leash.
			await vi.advanceTimersByTimeAsync(2000);
			expect(passes()).toBe(2);
			stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps asking when the chain could not be reached', async () => {
		vi.useFakeTimers();
		try {
			const {ledger, passes} = fakeLedger(watching('unreadable'));
			const stop = watchUnresolvedRequests({ledger, intervalMs: 1000});
			await vi.advanceTimersByTimeAsync(1000);
			expect(passes()).toBe(1);
			stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('backs off, so an abandoned tab does not hammer the node', async () => {
		vi.useFakeTimers();
		try {
			const {ledger, passes} = fakeLedger(watching('nonce-free'));
			const stop = watchUnresolvedRequests({
				ledger,
				intervalMs: 1000,
				maxIntervalMs: 4000,
			});
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(2000);
			await vi.advanceTimersByTimeAsync(4000);
			expect(passes()).toBe(3);
			// Ceiling reached: the next one is 4000, not 8000.
			await vi.advanceTimersByTimeAsync(4000);
			expect(passes()).toBe(4);
			stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('asks about nothing that cannot change', async () => {
		vi.useFakeTimers();
		try {
			const settled: InFlightState[] = [
				{
					requests: [request('a', 'x')],
					outcomes: {a: {status: 'nonce-consumed', nonce: 3}},
					dispatching: 0,
				},
				{
					requests: [request('a', 'x')],
					outcomes: {a: {status: 'broadcast-not-recorded', hash: '0xa'}},
					dispatching: 0,
				},
				{
					requests: [request('a', 'x')],
					outcomes: {a: {status: 'unknown', reason: 'no-baseline'}},
					dispatching: 0,
				},
				{
					requests: [request('a', 'x')],
					outcomes: {a: {status: 'unknown', reason: 'nonce-behind'}},
					dispatching: 0,
				},
				// Still in flight: the dispatch itself will settle this.
				{requests: [request('a', 'x')], outcomes: {}, dispatching: 1},
			];
			for (const state of settled) {
				const {ledger, passes} = fakeLedger(state);
				const stop = watchUnresolvedRequests({ledger, intervalMs: 1000});
				await vi.advanceTimersByTimeAsync(10_000);
				expect(passes(), JSON.stringify(state.outcomes)).toBe(0);
				stop();
			}
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops once the user acknowledges the notice', async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeLedger(watching('nonce-free'));
			const stop = watchUnresolvedRequests({
				ledger: fake.ledger,
				intervalMs: 1000,
			});
			await vi.advanceTimersByTimeAsync(1000);
			expect(fake.passes()).toBe(1);

			fake.set({requests: [], outcomes: {}, dispatching: 0});
			await vi.advanceTimersByTimeAsync(20_000);
			expect(fake.passes()).toBe(1);
			stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops when torn down', async () => {
		vi.useFakeTimers();
		try {
			const {ledger, passes} = fakeLedger(watching('nonce-free'));
			const stop = watchUnresolvedRequests({ledger, intervalMs: 1000});
			stop();
			await vi.advanceTimersByTimeAsync(20_000);
			expect(passes()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
