import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {
	hasUnansweredRequest,
	reconcileWhenAccountArrives,
	startInFlightTracking,
	watchUnresolvedRequests,
} from '../../../../src/lib/core/transaction/in-flight-tracking';
import {shouldPromptForWalletAction} from '../../../../src/lib/core/connection/wallet-activity';
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

describe('hasUnansweredRequest (what guardUnload watches)', () => {
	it('is true while the app is waiting on a dispatch', () => {
		expect(
			hasUnansweredRequest({
				requests: [request('a', 'setMessage')],
				outcomes: {},
				dispatching: 1,
				prompting: 1,
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
				prompting: 0,
			}),
		).toBe(false);
	});

	it('agrees with the wallet modal about a WALLET dispatch', () => {
		// Reported: a modal for a request, and no prompt when reloading. The three
		// things that should agree (modal, escape hatch, unload guard) were each
		// asking a different question. They now all rest on `dispatching`.
		//
		// With one caveat, which is the subject of the test below this one: the
		// modal reads `prompting`, so the two agree about a wallet send and part
		// company for a silent one, where the guard fires and the modal does not.
		const awaiting = {
			requests: [request('a', 'x')],
			outcomes: {},
			dispatching: 1,
			prompting: 1,
		};
		expect(hasUnansweredRequest(awaiting)).toBe(
			shouldPromptForWalletAction({step: 'WalletConnected'}, new Set(), {
				dispatchInFlight: awaiting.dispatching > 0,
				promptingDispatchInFlight: awaiting.prompting > 0,
			}),
		);
	});

	it('STILL guards unload for a dispatch no human was asked about', () => {
		// The half of the distinction that must NOT move. A local signer's send
		// raises no modal (see wallet-activity.test.ts), and is exactly as losable
		// between dispatch and hash as one a wallet is holding, so closing the tab
		// is exactly as bad an idea. Narrowing this to `prompting` would trade a
		// spurious modal for lost transactions.
		expect(
			hasUnansweredRequest({
				requests: [request('a', 'commit')],
				outcomes: {},
				dispatching: 1,
				prompting: 0,
			}),
		).toBe(true);
	});

	it('is false with nothing in flight', () => {
		expect(
			hasUnansweredRequest({
				requests: [],
				outcomes: {},
				dispatching: 0,
				prompting: 0,
			}),
		).toBe(false);
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
		prompting: 0,
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
					prompting: 0,
				},
				{
					requests: [request('a', 'x')],
					outcomes: {a: {status: 'broadcast-not-recorded', hash: '0xa'}},
					dispatching: 0,
					prompting: 0,
				},
				{
					requests: [request('a', 'x')],
					outcomes: {a: {status: 'unknown', reason: 'no-baseline'}},
					dispatching: 0,
					prompting: 0,
				},
				{
					requests: [request('a', 'x')],
					outcomes: {a: {status: 'unknown', reason: 'nonce-behind'}},
					dispatching: 0,
					prompting: 0,
				},
				// Still in flight: the dispatch itself will settle this.
				{
					requests: [request('a', 'x')],
					outcomes: {},
					dispatching: 1,
					prompting: 1,
				},
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

			fake.set({requests: [], outcomes: {}, dispatching: 0, prompting: 0});
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

describe('startInFlightTracking', () => {
	// The four things that keep the ledger honest, started as one, so the file
	// every adopter reads is not where they are assembled.
	it('reconciles at startup, watches, and guards, then stops all of it', async () => {
		vi.useFakeTimers();
		try {
			let passes = 0;
			const state = writable<InFlightState>({
				requests: [request('a', 'setMessage')],
				outcomes: {a: {status: 'unknown', reason: 'nonce-free'}},
				dispatching: 1,
				prompting: 1,
			});
			const ledger = {
				subscribe: state.subscribe,
				reconcile: async () => {
					passes++;
				},
			} as never;

			let guard: (() => boolean) | undefined;
			const account = writable<`0x${string}` | undefined>(undefined);
			const stop = startInFlightTracking({
				ledger,
				account,
				navigation: {
					guardUnload: (shouldBlock) => {
						guard = shouldBlock;
						return () => {
							guard = undefined;
						};
					},
				},
			});

			// Startup pass.
			expect(passes).toBe(1);
			// The guard is live and reads the ledger.
			expect(guard?.()).toBe(true);
			// An account arriving is new information.
			account.set(ACCOUNT);
			expect(passes).toBe(2);
			// And it keeps asking while the answer could still change.
			await vi.advanceTimersByTimeAsync(30_000);
			expect(passes).toBeGreaterThan(2);

			stop();
			const after = passes;
			account.set('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
			await vi.advanceTimersByTimeAsync(60_000);
			expect(passes).toBe(after);
			expect(guard).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});
