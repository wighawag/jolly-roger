import {describe, it, expect, vi} from 'vitest';
import {get} from 'svelte/store';
import {
	createInFlightLedger,
	type InFlightLedgerParams,
	type InFlightStorage,
} from '../../../../src/lib/core/transaction/in-flight-store';
import type {InFlightRequest} from '../../../../src/lib/core/transaction/in-flight';
import {StoppedWaitingError} from '../../../../src/lib/core/transaction/StoppedWaitingError';

const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const CHAIN_ID = 31337;
const KEY = `__in_flight_requests__${CHAIN_ID}`;

/** A localStorage stand-in whose contents the test can inspect directly. */
function fakeStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	const storage: InFlightStorage = {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
		},
		removeItem: (key) => {
			items.delete(key);
		},
	};
	return {
		storage,
		read(): InFlightRequest[] {
			const raw = items.get(KEY);
			return raw ? (JSON.parse(raw) as InFlightRequest[]) : [];
		},
		raw: () => items.get(KEY),
	};
}

function ledgerWith(overrides: Partial<InFlightLedgerParams> = {}) {
	const store = fakeStorage();
	const ledger = createInFlightLedger({
		storage: store.storage,
		chainId: CHAIN_ID,
		now: () => 1000,
		readNodeNonce: async () => 5,
		recordedNonces: async () => [],
		baselineTimeoutMs: 20,
		...overrides,
	});
	return {ledger, store};
}

describe('in-flight ledger: recording', () => {
	it('persists the record BEFORE the baseline nonce is known', async () => {
		// The window this whole feature exists for is the one where the next line
		// never runs. A record that only lands once an RPC answers is no record at
		// all: hang the read, and nothing would survive a reload.
		let releaseNonce: (n: number) => void = () => {};
		const store = fakeStorage();
		const ledger = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 1000,
			readNodeNonce: () =>
				new Promise<number | undefined>((resolve) => {
					releaseNonce = resolve;
				}),
			recordedNonces: async () => [],
			baselineTimeoutMs: 10_000,
		});

		const pending = ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
		});

		// Nothing has been awaited on the caller's side yet, and the record is
		// already durable.
		expect(store.read()).toHaveLength(1);
		expect(store.read()[0]).toMatchObject({
			account: ACCOUNT,
			chainId: CHAIN_ID,
			intent: {description: 'setMessage'},
			requestedAt: 1000,
		});
		// JSON drops an undefined field, so a record written before the baseline
		// arrives comes back with no `nonce` key at all. Same answer either way,
		// and `isInFlightRequest` accepts it.
		expect(store.read()[0].nonce).toBeUndefined();

		releaseNonce(5);
		await pending;
		expect(store.read()[0].nonce).toBe(5);
	});

	it('gives up on the baseline rather than blocking the transaction', async () => {
		vi.useFakeTimers();
		try {
			const store = fakeStorage();
			const ledger = createInFlightLedger({
				storage: store.storage,
				chainId: CHAIN_ID,
				now: () => 1000,
				readNodeNonce: () => new Promise<number | undefined>(() => {}),
				recordedNonces: async () => [],
				baselineTimeoutMs: 50,
			});

			const pending = ledger.record({
				account: ACCOUNT,
				intent: {description: 'setMessage'},
			});
			await vi.advanceTimersByTimeAsync(60);
			const handle = await pending;

			expect(handle.id).toBeTruthy();
			expect(store.read()[0].nonce).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('prefers a nonce the caller knows over the node baseline', async () => {
		// A resubmit knows the nonce it is replacing. The node's next expected
		// nonce is a different number and would reconcile against the wrong slot.
		const readNodeNonce = vi.fn(async () => 5);
		const {ledger, store} = ledgerWith({readNodeNonce});

		await ledger.record({
			account: ACCOUNT,
			intent: {description: 'Resubmit Transaction'},
			nonce: 2,
		});

		expect(store.read()[0].nonce).toBe(2);
		expect(readNodeNonce).not.toHaveBeenCalled();
	});
});

describe('in-flight ledger: settling', () => {
	it('drops the record once a hash comes back', async () => {
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
		});
		handle.broadcast();
		expect(store.read()).toHaveLength(0);
		expect(get(ledger).requests).toHaveLength(0);
	});

	it('drops the record on a rejection we observed', async () => {
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
		});
		handle.rejected();
		expect(store.read()).toHaveLength(0);
	});

	it('KEEPS the record on any other failure', async () => {
		// An RPC timeout, a wallet that vanished mid-request and a transaction that
		// was broadcast and then lost are indistinguishable here, and only one of
		// them means nothing was sent.
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
		});
		handle.leaveUnresolved();
		expect(store.read()).toHaveLength(1);
		expect(get(ledger).requests).toHaveLength(1);
	});

	it('clears the storage key entirely when the last record goes', async () => {
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
		});
		handle.broadcast();
		expect(store.raw()).toBeUndefined();
	});
});

describe('in-flight ledger: restoring', () => {
	it('finds records left by a previous tab', async () => {
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
		});
		handle.leaveUnresolved();

		// The reload: a second ledger over the same storage.
		const reloaded = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 2000,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});
		expect(get(reloaded).requests).toHaveLength(1);
		expect(get(reloaded).requests[0].intent.description).toBe('setMessage');
	});

	it('drops records it cannot read rather than reconciling against them', () => {
		const store = fakeStorage({
			[KEY]: JSON.stringify([
				{
					id: 'good',
					account: ACCOUNT,
					chainId: CHAIN_ID,
					nonce: 1,
					intent: {description: 'ok'},
					requestedAt: 1,
				},
				{whatIsThis: true},
			]),
		});
		const ledger = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 1,
			readNodeNonce: async () => 1,
			recordedNonces: async () => [],
		});
		expect(get(ledger).requests.map((r) => r.id)).toEqual(['good']);
	});

	it('survives a storage that will not write', async () => {
		const storage: InFlightStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota exceeded');
			},
			removeItem: () => {},
		};
		const ledger = createInFlightLedger({
			storage,
			chainId: CHAIN_ID,
			now: () => 1,
			readNodeNonce: async () => 1,
			recordedNonces: async () => [],
			baselineTimeoutMs: 20,
		});
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
		});
		expect(handle.id).toBeTruthy();
		expect(get(ledger).requests).toHaveLength(1);
	});
});

describe('in-flight ledger: reconciling', () => {
	async function unresolvedLedger(
		overrides: Partial<InFlightLedgerParams> = {},
	) {
		const {ledger, store} = ledgerWith(overrides);
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		handle.leaveUnresolved();
		return {ledger, store, id: handle.id};
	}

	it('silently forgets a record the app already has an operation for', async () => {
		const {ledger, store, id} = await unresolvedLedger({
			readNodeNonce: async () => 8,
			recordedNonces: async () => [7],
		});
		await ledger.reconcile();
		expect(get(ledger).requests).toHaveLength(0);
		expect(get(ledger).outcomes[id]).toBeUndefined();
		expect(store.read()).toHaveLength(0);
	});

	it('keeps and classifies a record the app cannot account for', async () => {
		const {ledger, id} = await unresolvedLedger({
			readNodeNonce: async () => 8,
			recordedNonces: async () => [],
		});
		await ledger.reconcile();
		expect(get(ledger).requests).toHaveLength(1);
		expect(get(ledger).outcomes[id]).toEqual({
			status: 'nonce-consumed',
			nonce: 7,
		});
	});

	it('reports unknown, never rejected, when nothing has landed', async () => {
		const {ledger, id} = await unresolvedLedger({
			readNodeNonce: async () => 7,
			recordedNonces: async () => [],
		});
		await ledger.reconcile();
		expect(get(ledger).outcomes[id]).toEqual({
			status: 'unknown',
			reason: 'nonce-free',
		});
	});

	it('reads the node once per account, not once per record', async () => {
		const readNodeNonce = vi.fn(async () => 9);
		const {ledger} = ledgerWith({
			readNodeNonce,
			recordedNonces: async () => [],
		});
		for (const account of [ACCOUNT, ACCOUNT, OTHER]) {
			const handle = await ledger.record({
				account,
				intent: {description: 'setMessage'},
				nonce: 1,
			});
			handle.leaveUnresolved();
		}
		readNodeNonce.mockClear();

		await ledger.reconcile();
		expect(readNodeNonce).toHaveBeenCalledTimes(2);
	});

	it('survives a node read that throws', async () => {
		const {ledger, id} = await unresolvedLedger({
			readNodeNonce: async () => {
				throw new Error('offline');
			},
			recordedNonces: async () => [],
		});
		await ledger.reconcile();
		expect(get(ledger).outcomes[id]).toEqual({
			status: 'unknown',
			reason: 'unreadable',
		});
	});

	it('does not lose a pass asked for while one is running', async () => {
		// Every caller of reconcile() is reacting to something that CHANGED (an
		// account arriving, a dismissal), and the running pass started before that
		// and cannot know about it. Collapsing into it reports what was true a
		// moment ago: the symptom was a reload saying a transaction might have been
		// sent while it sat in the user's list, because the startup pass ran before
		// the wallet reconnected and the pass that would have known was dropped.
		let release: (n: number | undefined) => void = () => {};
		let recorded: number[] = [];
		const {ledger} = ledgerWith({
			readNodeNonce: () =>
				new Promise<number | undefined>((resolve) => {
					release = resolve;
				}),
			recordedNonces: async () => recorded,
		});
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		handle.leaveUnresolved();

		const first = ledger.reconcile();
		// The world changes mid-pass: an account turned up, and the app can now see
		// that it holds an operation at this nonce after all.
		recorded = [7];
		const second = ledger.reconcile();
		release(8);
		await first;
		release(8);
		await second;

		// The quiet answer, from the second pass. Collapsed, this would still be
		// telling the user about a transaction they can already see.
		expect(get(ledger).requests).toHaveLength(0);
		expect(get(ledger).outcomes[handle.id]).toBeUndefined();
	});

	it('shares ONE trailing pass between callers arriving together', async () => {
		// Not lost, but not unbounded either: several callers during one pass owe
		// one more pass between them, not one each.
		const readNodeNonce = vi.fn(async () => 8);
		const {ledger} = ledgerWith({
			readNodeNonce,
			recordedNonces: async () => [],
		});
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		handle.leaveUnresolved();
		readNodeNonce.mockClear();

		await Promise.all([
			ledger.reconcile(),
			ledger.reconcile(),
			ledger.reconcile(),
		]);
		expect(readNodeNonce).toHaveBeenCalledTimes(2);
	});

	it('leaves a request dispatched mid-pass alone', async () => {
		// It has not been out long enough to have an answer, and calling it
		// unknown would raise a dialog about a wallet prompt still on screen.
		let release: (n: number | undefined) => void = () => {};
		const {ledger} = ledgerWith({
			readNodeNonce: () =>
				new Promise<number | undefined>((resolve) => {
					release = resolve;
				}),
			recordedNonces: async () => [],
		});
		const first = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'first'},
			nonce: 7,
		});
		first.leaveUnresolved();

		const pass = ledger.reconcile();
		const second = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'second'},
			nonce: 9,
		});
		release(8);
		await pass;

		expect(get(ledger).requests).toHaveLength(2);
		expect(get(ledger).outcomes[second.id]).toBeUndefined();
	});

	it('forgets everything the user has been shown, and nothing else', async () => {
		const {ledger} = ledgerWith({
			readNodeNonce: async () => 8,
			recordedNonces: async () => [],
		});
		const seen = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'seen'},
			nonce: 7,
		});
		seen.leaveUnresolved();
		await ledger.reconcile();

		const fresh = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'in flight right now'},
			nonce: 9,
		});
		fresh.leaveUnresolved();

		ledger.acknowledgeAll();
		expect(get(ledger).requests.map((r) => r.intent.description)).toEqual([
			'in flight right now',
		]);
	});

	it('acknowledging one record leaves the others', async () => {
		const {ledger} = ledgerWith({
			readNodeNonce: async () => 8,
			recordedNonces: async () => [],
		});
		const a = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'a'},
			nonce: 7,
		});
		a.leaveUnresolved();
		const b = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'b'},
			nonce: 8,
		});
		b.leaveUnresolved();

		ledger.acknowledge(a.id);
		expect(get(ledger).requests.map((r) => r.id)).toEqual([b.id]);
	});
});

describe('in-flight ledger: a broadcast nobody could file', () => {
	// The worst outcome available: the transaction is on chain, the app has its
	// hash, and account data is gone (the account went away between dispatch and
	// answer). Losing it here means the user sent something the app has no note
	// of anywhere, which is the exact failure this whole feature exists to stop.
	async function inFlightRequest(nonce: number | undefined = 7) {
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce,
		});
		return {ledger, store, handle};
	}

	it('keeps the record, with the hash, instead of losing the transaction', async () => {
		const {ledger, store, handle} = await inFlightRequest(7);

		ledger.noteUnrecordedBroadcast({account: ACCOUNT, nonce: 7, hash: '0xabc'});

		expect(get(ledger).outcomes[handle.id]).toEqual({
			status: 'broadcast-not-recorded',
			hash: '0xabc',
			nonce: 7,
		});
		expect(store.read()).toHaveLength(1);
	});

	it('survives broadcast() arriving straight afterwards', async () => {
		// Ordering that actually happens: the tracker emits
		// `transaction:broadcasted` (where filing fails) BEFORE `writeContract`
		// returns the hash, so the guard's broadcast() lands moments later on the
		// same call stack. If it dropped the record then, the note would exist for
		// microseconds and the transaction would be lost anyway.
		const {ledger, store, handle} = await inFlightRequest(7);

		ledger.noteUnrecordedBroadcast({account: ACCOUNT, nonce: 7, hash: '0xabc'});
		handle.broadcast();

		expect(get(ledger).requests).toHaveLength(1);
		expect(get(ledger).outcomes[handle.id].status).toBe(
			'broadcast-not-recorded',
		);
		expect(store.read()).toHaveLength(1);
	});

	it('still drops the record on a normal successful send', async () => {
		// Guards the guard above: broadcast() must only be a no-op for a record
		// that was actually marked, or every send would leave litter.
		const {ledger, store, handle} = await inFlightRequest(7);
		handle.broadcast();
		expect(get(ledger).requests).toHaveLength(0);
		expect(store.read()).toHaveLength(0);
	});

	it('is never overwritten by a nonce guess', async () => {
		// Having watched it happen beats anything a nonce comparison can deduce,
		// and it is the only outcome that carries a hash.
		const {ledger, handle} = await inFlightRequest(7);
		ledger.noteUnrecordedBroadcast({account: ACCOUNT, nonce: 7, hash: '0xabc'});

		await ledger.reconcile();

		expect(get(ledger).outcomes[handle.id]).toEqual({
			status: 'broadcast-not-recorded',
			hash: '0xabc',
			nonce: 7,
		});
	});

	it('matches the record with no baseline when the nonce cannot pick one', async () => {
		const {ledger, handle} = await inFlightRequest(undefined);
		ledger.noteUnrecordedBroadcast({
			account: ACCOUNT,
			nonce: undefined,
			hash: '0xabc',
		});
		expect(get(ledger).outcomes[handle.id].status).toBe(
			'broadcast-not-recorded',
		);
	});

	it("never attaches a hash to another account's request", async () => {
		const {ledger, handle} = await inFlightRequest(7);
		ledger.noteUnrecordedBroadcast({account: OTHER, nonce: 7, hash: '0xabc'});
		expect(get(ledger).outcomes[handle.id]).toBeUndefined();
	});

	it('shouts rather than swallowing a hash it cannot place', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const {ledger} = ledgerWith();
			ledger.noteUnrecordedBroadcast({
				account: ACCOUNT,
				nonce: 7,
				hash: '0xabc',
			});
			expect(error).toHaveBeenCalled();
			expect(String(error.mock.calls[0][0])).toContain('0xabc');
		} finally {
			error.mockRestore();
		}
	});
});

describe('in-flight ledger: releasing the caller without abandoning the request', () => {
	// Reported from real use: after stopping waiting, the Send button stayed
	// disabled and spinning. Dismissing the modal released the user from a
	// dialog, but whatever started the send was still awaiting a promise that a
	// wallet is under no obligation to settle.
	it('rejects the awaiting caller with StoppedWaitingError', async () => {
		const {ledger} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});

		ledger.stopAwaiting();

		await expect(handle.abandoned).rejects.toThrow(StoppedWaitingError);
	});

	it('KEEPS the record, because the request is still with the wallet', async () => {
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});

		ledger.stopAwaiting();
		await expect(handle.abandoned).rejects.toThrow();

		expect(get(ledger).requests).toHaveLength(1);
		expect(store.read()).toHaveLength(1);
	});

	it('still settles from the real outcome after the caller has gone', async () => {
		// The promise the escape hatch makes: approving later still records it.
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		ledger.stopAwaiting();
		await expect(handle.abandoned).rejects.toThrow();

		handle.broadcast();

		expect(get(ledger).requests).toHaveLength(0);
		expect(store.read()).toHaveLength(0);
	});

	it('does not release a dispatch that already settled', async () => {
		const {ledger} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		handle.broadcast();

		let rejected = false;
		handle.abandoned.catch(() => {
			rejected = true;
		});
		ledger.stopAwaiting();
		await Promise.resolve();
		await Promise.resolve();

		expect(rejected).toBe(false);
	});

	it('releases every caller at once', async () => {
		const {ledger} = ledgerWith();
		const first = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'a'},
			nonce: 1,
		});
		const second = await ledger.record({
			account: OTHER,
			intent: {description: 'b'},
			nonce: 2,
		});

		ledger.stopAwaiting();

		await expect(first.abandoned).rejects.toThrow(StoppedWaitingError);
		await expect(second.abandoned).rejects.toThrow(StoppedWaitingError);
	});
});

describe('in-flight ledger: dispatching, the one fact three things rest on', () => {
	// The wallet-action modal, the escape hatch and the unload guard each used to
	// ask a different question, so they could disagree: a modal with no guard
	// behind it was reported from real use.
	it('does NOT count a record whose wallet has not been asked yet', async () => {
		// `record()` persists and then reads a baseline nonce. Everything in that
		// window is preparation, and counting it put "confirm the request in your
		// wallet" on screen for a request the wallet did not have.
		const {ledger} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});

		expect(get(ledger).requests).toHaveLength(1);
		expect(get(ledger).dispatching).toBe(0);

		handle.dispatched();
		expect(get(ledger).dispatching).toBe(1);
	});

	it('stops counting on every way a dispatch can end', async () => {
		for (const end of ['broadcast', 'rejected', 'leaveUnresolved'] as const) {
			const {ledger} = ledgerWith();
			const handle = await ledger.record({
				account: ACCOUNT,
				intent: {description: 'setMessage'},
				nonce: 7,
			});
			handle.dispatched();
			expect(get(ledger).dispatching, end).toBe(1);
			handle[end]();
			expect(get(ledger).dispatching, end).toBe(0);
		}
	});

	it('knows, synchronously, that a caller gave up mid-preparation', async () => {
		// The caller has to decide whether to dispatch AT ALL, and cannot consult
		// a promise in time.
		const {ledger} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		expect(handle.wasAbandoned()).toBe(false);

		ledger.stopAwaiting();
		expect(handle.wasAbandoned()).toBe(true);

		// And a request that was never sent leaves no record behind, because that
		// is knowledge rather than a guess.
		handle.discard();
		expect(get(ledger).requests).toHaveLength(0);
		await expect(handle.abandoned).rejects.toThrow();
	});

	it('refuses to count a dispatch that was abandoned first', async () => {
		const {ledger} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		ledger.stopAwaiting();

		handle.dispatched();

		expect(get(ledger).dispatching).toBe(0);
		await expect(handle.abandoned).rejects.toThrow();
	});

	it('stops counting when the user gives up', async () => {
		const {ledger} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});

		handle.dispatched();
		expect(get(ledger).dispatching).toBe(1);

		ledger.stopAwaiting();
		await expect(handle.abandoned).rejects.toThrow();

		// The record survives; the waiting does not.
		expect(get(ledger).dispatching).toBe(0);
		expect(get(ledger).requests).toHaveLength(1);
	});

	it('is zero for records restored from a previous session', async () => {
		const {ledger, store} = ledgerWith();
		const handle = await ledger.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		handle.leaveUnresolved();

		const reloaded = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 2000,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});

		expect(get(reloaded).requests).toHaveLength(1);
		expect(get(reloaded).dispatching).toBe(0);
	});
});

describe('in-flight ledger: records are scoped and bounded', () => {
	it('keeps records of one chain out of another chain with the same id', async () => {
		// A restarted dev node returns as the same chain id with a different
		// history, which is the premise of nonce-cache.ts. Reconciling a record
		// from the old chain against the new one compares nonces across histories.
		const store = fakeStorage();
		const before = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			genesisHash: '0xold',
			now: () => 1000,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});
		const handle = await before.record({
			account: ACCOUNT,
			intent: {description: 'setMessage'},
			nonce: 7,
		});
		handle.leaveUnresolved();

		const afterReset = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			genesisHash: '0xnew',
			now: () => 1000,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});
		expect(get(afterReset).requests).toHaveLength(0);
	});

	it('drops records too old to mean anything', async () => {
		// Nothing else bounds the list: a record survives until acknowledged, and
		// one the user never saw would otherwise live for ever. Past a week the
		// nonce comparison says nothing anyway.
		const eightDays = 8 * 24 * 60 * 60 * 1000;
		const store = fakeStorage();
		const first = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 1000,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});
		const handle = await first.record({
			account: ACCOUNT,
			intent: {description: 'ancient'},
			nonce: 7,
		});
		handle.leaveUnresolved();

		const muchLater = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 1000 + eightDays,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});
		expect(get(muchLater).requests).toHaveLength(0);
	});

	it('keeps a record that is merely old', async () => {
		const oneDay = 24 * 60 * 60 * 1000;
		const store = fakeStorage();
		const first = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 1000,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});
		const handle = await first.record({
			account: ACCOUNT,
			intent: {description: 'yesterday'},
			nonce: 7,
		});
		handle.leaveUnresolved();

		const nextDay = createInFlightLedger({
			storage: store.storage,
			chainId: CHAIN_ID,
			now: () => 1000 + oneDay,
			readNodeNonce: async () => 5,
			recordedNonces: async () => [],
		});
		expect(get(nextDay).requests).toHaveLength(1);
	});
});

describe('in-flight ledger: a read that never answers', () => {
	/**
	 * THE BUG THIS PINS, which cost nothing to write and everything to find.
	 *
	 * `reconcileOnce` awaited its two reads with only a `.catch()` on them. A
	 * REJECTED read was handled; a read that simply never settles was not, and
	 * those are different things. The default `readNodeNonce` is a bare `fetch`
	 * with no signal, so "never settles" is its behaviour against an endpoint
	 * that accepts the connection and then stalls.
	 *
	 * The consequence is the worst kind: nothing throws, nothing logs, and the
	 * ledger simply stops producing outcomes. Since a request is only REPORTED
	 * once it has an outcome, the notice telling a user their transaction may be
	 * sitting in the mempool is silently never shown - by the one mechanism whose
	 * entire purpose is to not lose that transaction.
	 *
	 * Found by e2e (eight browsers, one node, a ~10ms call outstanding past
	 * twenty seconds), which is the only place it could have been found: every
	 * unit test until now supplied a reader that answers.
	 */
	it('still reconciles, and says so, when the node never answers', async () => {
		vi.useFakeTimers();
		try {
			const store = fakeStorage();
			const ledger = createInFlightLedger({
				storage: store.storage,
				chainId: CHAIN_ID,
				now: () => 1000,
				// Answers the BASELINE read, then goes silent. That is the shape of
				// the real failure: the record has a nonce to compare against, and
				// the later read is the one that stalls. Not a rejection: a silence.
				readNodeNonce: (() => {
					let answered = false;
					return () => {
						if (answered) return new Promise<number | undefined>(() => {});
						answered = true;
						return Promise.resolve(7);
					};
				})(),
				recordedNonces: async () => [],
				baselineTimeoutMs: 20,
				readTimeoutMs: 5000,
			});

			const dispatch = ledger.record({
				account: ACCOUNT,
				intent: {description: 'setMessage'},
			});
			await vi.advanceTimersByTimeAsync(50);
			await dispatch;

			let settled = false;
			const pass = ledger.reconcile().then(() => {
				settled = true;
			});

			// Before the deadline it is still waiting, which is correct.
			await vi.advanceTimersByTimeAsync(4000);
			expect(settled).toBe(false);

			// After it, the pass completes rather than hanging for ever.
			await vi.advanceTimersByTimeAsync(2000);
			await pass;
			expect(settled).toBe(true);

			// And it reached a real conclusion: unreadable, which is watchable, so
			// the watcher will ask again and the app heals itself.
			const state = get(ledger);
			expect(state.requests).toHaveLength(1);
			const outcome = state.outcomes[state.requests[0].id];
			expect(outcome).toBeDefined();
			expect(outcome?.status).toBe('unknown');
			expect(outcome && 'reason' in outcome ? outcome.reason : undefined).toBe(
				'unreadable',
			);
		} finally {
			vi.useRealTimers();
		}
	});
});
