import {describe, it, expect, vi} from 'vitest';
import {get} from 'svelte/store';
import {
	describeRequest,
	guardDispatch,
	isDispatchGuarded,
	resolveSender,
} from '../../../../src/lib/core/transaction/dispatch-guard';
import {
	createInFlightLedger,
	type InFlightLedger,
	type InFlightStorage,
} from '../../../../src/lib/core/transaction/in-flight-store';
import {StoppedWaitingError} from '../../../../src/lib/core/transaction/StoppedWaitingError';

const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;

function memoryStorage(): InFlightStorage {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
		},
		removeItem: (key) => {
			items.delete(key);
		},
	};
}

function ledger(): InFlightLedger {
	return createInFlightLedger({
		storage: memoryStorage(),
		chainId: 31337,
		now: () => 1000,
		readNodeNonce: async () => 4,
		recordedNonces: async () => [],
		baselineTimeoutMs: 50,
	});
}

/** A stand-in for the tracked wallet client, with an observable emitter. */
function fakeClient(behaviour: {
	send?: (args?: unknown) => Promise<unknown>;
	account?: `0x${string}`;
}) {
	const send = behaviour.send ?? (async (_args?: unknown) => '0xhash');
	const listeners: unknown[] = [];
	return {
		walletClient: behaviour.account
			? {account: {address: behaviour.account}}
			: undefined,
		writeContract: vi.fn(send),
		sendTransaction: vi.fn(send),
		sendRawTransaction: vi.fn(send),
		writeContractSync: vi.fn(send),
		sendTransactionSync: vi.fn(send),
		sendRawTransactionSync: vi.fn(send),
		on: (listener: unknown) => {
			listeners.push(listener);
			return () => {};
		},
		listeners,
	};
}

describe('resolveSender', () => {
	it('reads an address passed directly', () => {
		expect(resolveSender({account: ACCOUNT}, fakeClient({}))).toBe(ACCOUNT);
	});

	it('reads the address of an Account object', () => {
		expect(
			resolveSender(
				{account: {address: ACCOUNT, type: 'local'}},
				fakeClient({}),
			),
		).toBe(ACCOUNT);
	});

	it("falls back to the client's own account", () => {
		expect(resolveSender({}, fakeClient({account: ACCOUNT}))).toBe(ACCOUNT);
	});

	it('answers undefined rather than guessing', () => {
		// A record filed against the wrong account reconciles against the wrong
		// nonce, and would then report on a transaction that never existed.
		expect(resolveSender({}, fakeClient({}))).toBeUndefined();
	});
});

describe('describeRequest', () => {
	it('names a contract call by its function, like the transaction list does', () => {
		expect(
			describeRequest(
				{address: CONTRACT, functionName: 'setMessage'},
				'Contract call',
			),
		).toEqual({
			description: 'setMessage',
			to: CONTRACT,
			functionName: 'setMessage',
		});
	});

	it('uses the name carried by unknown-type metadata', () => {
		expect(
			describeRequest(
				{
					to: CONTRACT,
					metadata: {type: 'unknown', name: 'Resubmit Transaction'},
				},
				'Transaction',
			),
		).toEqual({description: 'Resubmit Transaction', to: CONTRACT});
	});

	it('falls back rather than leaving the user with nothing to read', () => {
		expect(describeRequest({}, 'Transaction')).toEqual({
			description: 'Transaction',
		});
	});
});

describe('guardDispatch', () => {
	it('records before dispatching, and drops the record on a hash', async () => {
		const book = ledger();
		let recordedDuringDispatch = 0;
		const client = fakeClient({
			account: ACCOUNT,
			send: async () => {
				recordedDuringDispatch = get(book).requests.length;
				return '0xhash';
			},
		});

		const guardedClient = guardDispatch(client, book);
		await guardedClient.writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);

		expect(recordedDuringDispatch).toBe(1);
		expect(get(book).requests).toHaveLength(0);
	});

	it('drops the record when the wallet reports a user rejection', async () => {
		const book = ledger();
		const client = fakeClient({
			account: ACCOUNT,
			send: async () => {
				throw {code: 4001, message: 'User rejected the request'};
			},
		});

		await expect(
			guardDispatch(client, book).writeContract({
				address: CONTRACT,
				functionName: 'setMessage',
			} as never),
		).rejects.toBeTruthy();

		expect(get(book).requests).toHaveLength(0);
	});

	it('KEEPS the record when the failure is not an observed rejection', async () => {
		// The transaction may well be in the mempool. Recording a rejection here
		// is precisely the lie this feature exists to prevent.
		const book = ledger();
		const client = fakeClient({
			account: ACCOUNT,
			send: async () => {
				throw new Error('socket hang up');
			},
		});

		await expect(
			guardDispatch(client, book).writeContract({
				address: CONTRACT,
				functionName: 'setMessage',
			} as never),
		).rejects.toThrow('socket hang up');

		expect(get(book).requests).toHaveLength(1);
		expect(get(book).requests[0].intent.description).toBe('setMessage');
	});

	it('guards every sending method, so none is a hole', async () => {
		const methods = [
			'writeContract',
			'sendTransaction',
			'sendRawTransaction',
			'writeContractSync',
			'sendTransactionSync',
			'sendRawTransactionSync',
		] as const;

		for (const method of methods) {
			const book = ledger();
			const client = fakeClient({
				account: ACCOUNT,
				send: async () => {
					throw new Error('socket hang up');
				},
			});
			await expect(
				guardDispatch(client, book)[method]({} as never),
			).rejects.toThrow('socket hang up');
			expect(get(book).requests, `${method} left no record`).toHaveLength(1);
		}
	});

	it('dispatches unguarded when there is no sender to file a record against', async () => {
		const book = ledger();
		const client = fakeClient({});
		await guardDispatch(client, book).sendTransaction({} as never);
		expect(get(book).requests).toHaveLength(0);
		expect(client.sendTransaction).toHaveBeenCalled();
	});

	it('returns one wrapper per client, so nothing ends up unlistened to', () => {
		// executor.ts explains why: transaction tracking attaches listeners per
		// client and identifies them by reference, so a second wrapper object is a
		// client whose transactions are silently never reported.
		const book = ledger();
		const client = fakeClient({account: ACCOUNT});
		const first = guardDispatch(client, book);
		expect(guardDispatch(client, book)).toBe(first);
		expect(guardDispatch(first, book)).toBe(first);
		expect(isDispatchGuarded(first)).toBe(true);
		expect(isDispatchGuarded(client)).toBe(false);
	});

	it('leaves everything it does not send through alone', async () => {
		const book = ledger();
		const client = fakeClient({account: ACCOUNT});
		const guardedClient = guardDispatch(client, book);
		guardedClient.on('listener');
		expect(client.listeners).toEqual(['listener']);
		expect(guardedClient.walletClient).toBe(client.walletClient);
	});
});

describe('guardDispatch: whether a send needs a human, recorded not inferred', () => {
	// A count of dispatches cannot tell a wallet apart from a key the app holds
	// itself, and reading one as the other raised "Wallet Action Required" for
	// transactions no wallet and no human was involved in. Whether a client
	// prompts is known where it is BUILT, so it is stated there and carried per
	// dispatch.
	function pendingClient() {
		let answer: (hash: string) => void = () => {};
		const client = fakeClient({
			account: ACCOUNT,
			send: () =>
				new Promise((resolve) => {
					answer = resolve;
				}),
		});
		return {client, answer: (hash: string) => answer(hash)};
	}

	it('counts a silent send as dispatched, but not as prompting', async () => {
		const book = ledger();
		const {client, answer} = pendingClient();

		const call = guardDispatch(client, book, {prompts: false}).writeContract({
			address: CONTRACT,
			functionName: 'commit',
		} as never);

		await vi.waitFor(() => expect(get(book).dispatching).toBe(1));
		// The whole distinction, in one line: outstanding, guarded against a
		// reload, and nothing for the user to go and do.
		expect(get(book).prompting).toBe(0);

		answer('0xhash');
		await call;
		expect(get(book).dispatching).toBe(0);
		expect(get(book).prompting).toBe(0);
	});

	it('prompts by default, so an unchanged call site is unchanged', async () => {
		const book = ledger();
		const {client, answer} = pendingClient();

		const call = guardDispatch(client, book).writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);

		await vi.waitFor(() => expect(get(book).dispatching).toBe(1));
		expect(get(book).prompting).toBe(1);

		answer('0xhash');
		await call;
		expect(get(book).prompting).toBe(0);
	});

	it('keeps the two kinds apart when both are in flight', async () => {
		// The state a local-signer app is in constantly: a user's own transaction
		// with the wallet while a background send goes out silently. One prompt,
		// two dispatches.
		const book = ledger();
		const wallet = pendingClient();
		const signer = pendingClient();

		const walletCall = guardDispatch(wallet.client, book).writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);
		const signerCall = guardDispatch(signer.client, book, {
			prompts: false,
		}).writeContract({address: CONTRACT, functionName: 'commit'} as never);

		await vi.waitFor(() => expect(get(book).dispatching).toBe(2));
		expect(get(book).prompting).toBe(1);

		// The wallet answers first: nothing is left to prompt about, though a
		// dispatch is still outstanding and still worth an unload warning.
		wallet.answer('0xhash');
		await walletCall;
		expect(get(book).dispatching).toBe(1);
		expect(get(book).prompting).toBe(0);

		signer.answer('0xhash');
		await signerCall;
		expect(get(book).dispatching).toBe(0);
		expect(get(book).prompting).toBe(0);
	});

	it('warns when the same client is guarded both ways', () => {
		// Whether sends prompt is a property of the key that signs, so two callers
		// disagreeing means one of them is wrong. Both already-guarded paths report
		// it: handing back the WRAPPER is the likelier mistake once an app has two
		// guarded clients, and it used to be the silent one.
		const book = ledger();
		const client = fakeClient({account: ACCOUNT});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const wrapper = guardDispatch(client, book);
			expect(warn).not.toHaveBeenCalled();

			// Same raw client, opposite answer.
			expect(guardDispatch(client, book, {prompts: false})).toBe(wrapper);
			expect(warn).toHaveBeenCalledTimes(1);

			// Same wrapper, opposite answer.
			expect(guardDispatch(wrapper, book, {prompts: false})).toBe(wrapper);
			expect(warn).toHaveBeenCalledTimes(2);

			// Agreeing is not worth a word.
			guardDispatch(wrapper, book);
			guardDispatch(client, book, {prompts: true});
			expect(warn).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
		}
	});

	it('releases the prompting count when the user stops waiting', async () => {
		const book = ledger();
		const {client} = pendingClient();
		const call = guardDispatch(client, book).writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);
		await vi.waitFor(() => expect(get(book).prompting).toBe(1));

		book.stopAwaiting();
		await expect(call).rejects.toThrow(StoppedWaitingError);
		// Both sets are cleared together, or the modal would come straight back
		// for a request the user has just given up on.
		expect(get(book).prompting).toBe(0);
		expect(get(book).dispatching).toBe(0);
	});
});

describe('guardDispatch: stopping waiting releases the caller, not the request', () => {
	it('rejects the caller with StoppedWaitingError while the send runs on', async () => {
		// Reported from real use: the Send button stayed disabled and spinning
		// after stopping waiting, because the page was still awaiting a promise a
		// wallet is under no obligation to settle.
		const book = ledger();
		let answerWallet: (hash: string) => void = () => {};
		const client = fakeClient({
			account: ACCOUNT,
			send: () =>
				new Promise((resolve) => {
					answerWallet = resolve;
				}),
		});

		const call = guardDispatch(client, book).writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);

		// Wait until the wallet has actually been asked. The record exists a beat
		// earlier, while the baseline nonce is still being read, and stopping
		// waiting in THAT window is a different case (covered below).
		await vi.waitFor(() => expect(get(book).dispatching).toBe(1));

		book.stopAwaiting();
		await expect(call).rejects.toThrow(StoppedWaitingError);

		// The request was NOT withdrawn: its record is still open, waiting.
		expect(get(book).requests).toHaveLength(1);

		// And approving later still records it, which is the promise the escape
		// hatch makes to the user.
		answerWallet('0xhash');
		await vi.waitFor(() => expect(get(book).requests).toHaveLength(0));
	});

	it('does not report a late failure as an unhandled rejection', async () => {
		// The dispatch outlives the caller, so its rejection has to stay handled
		// even though nobody is awaiting it any more.
		const book = ledger();
		let failWallet: (error: unknown) => void = () => {};
		const client = fakeClient({
			account: ACCOUNT,
			send: () =>
				new Promise((_, reject) => {
					failWallet = reject;
				}),
		});
		const unhandled: unknown[] = [];
		const onUnhandled = (event: PromiseRejectionEvent) => {
			unhandled.push(event.reason);
		};
		process.on('unhandledRejection', onUnhandled as never);
		try {
			const call = guardDispatch(client, book).writeContract({
				address: CONTRACT,
				functionName: 'setMessage',
			} as never);
			await vi.waitFor(() => expect(get(book).dispatching).toBe(1));

			book.stopAwaiting();
			await expect(call).rejects.toThrow(StoppedWaitingError);

			failWallet(new Error('socket hang up'));
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(unhandled).toEqual([]);
			// Unresolvable, so the record stays for reconciliation.
			expect(get(book).requests).toHaveLength(1);
		} finally {
			process.off('unhandledRejection', onUnhandled as never);
		}
	});

	it('is unaffected when nobody stops waiting', async () => {
		const book = ledger();
		const client = fakeClient({account: ACCOUNT});
		const hash = await guardDispatch(client, book).writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);
		expect(hash).toBe('0xhash');
		expect(get(book).requests).toHaveLength(0);
	});
});

describe('guardDispatch: giving up before the wallet is even asked', () => {
	// `record()` persists and then reads a baseline nonce, which can take
	// seconds against a slow RPC. Everything in that window is preparation: the
	// wallet has not been asked for anything yet.
	function slowBaselineLedger() {
		let releaseBaseline: (n: number | undefined) => void = () => {};
		const book = createInFlightLedger({
			storage: memoryStorage(),
			chainId: 31337,
			now: () => 1000,
			readNodeNonce: () =>
				new Promise<number | undefined>((resolve) => {
					releaseBaseline = resolve;
				}),
			recordedNonces: async () => [],
			baselineTimeoutMs: 10_000,
		});
		return {book, release: () => releaseBaseline(4)};
	}

	it('says nothing is with the wallet while the baseline is still being read', async () => {
		// Otherwise "Please confirm the request in your wallet" is on screen, with
		// an escape hatch, for a request the wallet does not have.
		const {book, release} = slowBaselineLedger();
		const client = fakeClient({account: ACCOUNT});

		const call = guardDispatch(client, book).writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);

		await vi.waitFor(() => expect(get(book).requests).toHaveLength(1));
		// Recorded, and durable, but not yet dispatched.
		expect(get(book).dispatching).toBe(0);
		expect(client.writeContract).not.toHaveBeenCalled();

		release();
		await call;
		expect(client.writeContract).toHaveBeenCalled();
	});

	it('never asks the wallet at all if the user gave up first', async () => {
		const {book, release} = slowBaselineLedger();
		const client = fakeClient({account: ACCOUNT});

		const call = guardDispatch(client, book).writeContract({
			address: CONTRACT,
			functionName: 'setMessage',
		} as never);
		await vi.waitFor(() => expect(get(book).requests).toHaveLength(1));

		book.stopAwaiting();
		release();

		await expect(call).rejects.toThrow(StoppedWaitingError);
		// The wallet was never shown it...
		expect(client.writeContract).not.toHaveBeenCalled();
		// ...so the record would be a lie, and it goes. The only case where
		// dropping one is knowledge rather than a guess.
		expect(get(book).requests).toHaveLength(0);
	});
});
