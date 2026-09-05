import {describe, it, expect, vi} from 'vitest';
import {readable} from 'svelte/store';
import {
	resubmitOperation,
	cancelOperation,
} from '../../../src/lib/ui/pending-operation/operation-actions';
import {createTrackedWalletConnector} from '../../../src/lib/account/connectors';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import type {Sender} from '../../../src/lib/core/connection/senders';
import type {ExecutorState} from '../../../src/lib/core/connection/executor';

/**
 * HOW A REPLACEMENT FINDS ITS OPERATION.
 *
 * `correlation` (tx-tracker 0.2.0) is an opaque per-call marker: the resubmit
 * names the operation it is replacing, the tracker carries the value verbatim
 * onto `transaction:broadcasted`, and the handler routes on it. It rides
 * BESIDE `metadata`, never inside it, because metadata is what the application
 * says a transaction MEANS and it gets persisted, so routing plumbing put there
 * ends up in every stored record forever.
 *
 * It replaces two things, and this file is the reason both are gone:
 *
 * 1. An `operationId` stamped into metadata. Persisted plumbing.
 * 2. An out-of-band map keyed on `from:nonce`. Unsound twice over: the write
 *    happens before a send whose emit is on the far side of the WALLET ROUND
 *    TRIP (popup, user reads it, user confirms), during which the page stays
 *    interactive and can issue more sends; and `(from, nonce)` is not unique,
 *    because replacing or cancelling deliberately creates a second operation at
 *    the same nonce. The concurrency test below is exactly that collision, and
 *    it is the case the map got wrong.
 */

const PAYER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;
const GREETER = '0x5fbdb2315678afecb367f032d93f642f64180aa3' as `0x${string}`;

/** A stuck operation at a given nonce, as the store holds it. */
const stuck = (nonce = 4): OnchainOperation =>
	({
		metadata: {type: 'functionCall', functionName: 'setMessage', args: ['hi']},
		call: {
			from: PAYER,
			to: GREETER,
			value: 0n,
			data: '0xa4136862',
			source: {route: 'account'},
		},
		attempts: [
			{
				hash: '0xdead',
				nonce,
				broadcastTimestampMs: 1,
				gasParameters: {maxFeePerGas: 10n, maxPriorityFeePerGas: 1n},
			},
		],
	}) as unknown as OnchainOperation;

/**
 * The tracker's broadcast event for a send, built the way the real one is:
 * `correlation` carried verbatim from the request, as a sibling of `metadata`.
 */
function broadcastEventFor(request: Record<string, unknown>, hash: string) {
	return {
		known: false,
		hash,
		from: PAYER,
		to: request.to,
		value: request.value ?? 0n,
		data: request.data ?? '0x',
		nonce: request.nonce,
		broadcastTimestampMs: 2000,
		gasParameters: {
			maxFeePerGas: request.maxFeePerGas,
			maxPriorityFeePerGas: request.maxPriorityFeePerGas,
		},
		source: {route: 'account'},
		metadata: request.metadata,
		correlation: request.correlation,
	};
}

/** The real broadcast connector over account data we can inspect. */
function wiredConnector(options: {existingOperations?: Set<string>} = {}) {
	const existing = options.existingOperations;
	const listeners = new Set<(tx: unknown) => void>();
	const attached: {operationId: string; tx: any}[] = [];
	const created: any[] = [];

	const connector = createTrackedWalletConnector({
		walletClient: {
			on: (event: string, listener: (tx: unknown) => void) => {
				if (event === 'transaction:broadcasted') listeners.add(listener);
				return () => listeners.delete(listener);
			},
		} as never,
		accountData: {
			addTransactionToOperation: (operationId: string, tx: unknown) => {
				// Mirrors the real one: false when the named operation is gone, so
				// the connector can fall back rather than drop the transaction.
				if (existing && !existing.has(operationId)) return false;
				attached.push({operationId, tx});
				return true;
			},
			addOperationFromTrackedTransaction: (tx: unknown) => created.push(tx),
			updateOperationFromKnownTransaction: () => {},
		} as never,
	});
	connector.connect();

	return {
		attached,
		created,
		broadcast: (tx: unknown) => {
			for (const listener of listeners) listener(tx);
		},
	};
}

/**
 * An executor whose sends are held open until released, so two replacements can
 * genuinely be in flight at once. That is not a contrivance: the tracker emits
 * after the wallet returns, so every real send is open for as long as the user
 * takes to confirm, and the page is live throughout.
 */
function deferredExecutor(broadcast: (tx: unknown) => void): Extract<
	ExecutorState,
	{status: 'ready'}
> & {
	release: (hash: string) => Promise<void>;
	/** Every request handed to the wallet, in the order it was issued. */
	requests: Record<string, unknown>[];
} {
	const pending: Record<string, unknown>[] = [];
	const requests: Record<string, unknown>[] = [];
	const resolveNext: (() => void)[] = [];

	const executor = {
		status: 'ready' as const,
		address: PAYER,
		account: PAYER,
		client: {
			sendTransaction: vi.fn((request: Record<string, unknown>) => {
				pending.push(request);
				requests.push(request);
				return new Promise<string>((resolve) => {
					resolveNext.push(() => resolve('0xok'));
				});
			}),
		} as never,
	};

	return {
		...executor,
		requests,
		/**
		 * Emit the broadcast for the FIRST still-open send, then let it return.
		 *
		 * Waits for the send to actually be issued: the replacement path awaits
		 * `ensureCanSign` and the balance check before it reaches the wallet, so
		 * releasing eagerly would race those and find nothing in flight.
		 */
		release: async (hash: string) => {
			await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
			const request = pending.shift()!;
			const done = resolveNext.shift()!;
			broadcast(broadcastEventFor(request, hash));
			done();
		},
	};
}

function senderFor(state: ExecutorState): Sender[] {
	return [
		{
			route: 'account',
			executor: readable(state),
			balance: {} as never,
			ensureCanSign: vi.fn(async () => {}),
		},
	];
}

const deps = (senders: Sender[]) => ({
	senders,
	deployments: readable({chain: {id: 31337}}) as never,
	balanceCheck: {
		ensureCanAfford: vi.fn(
			async ({transaction}: {transaction: unknown}) => transaction,
		),
	} as never,
	gasFee: readable({step: 'Loaded', fast: {maxFeePerGas: 20n}}) as never,
});

const gasPrice = {maxFeePerGas: 30n, maxPriorityFeePerGas: 2n};

describe('a resubmit', () => {
	it('names its operation in `correlation`, not in the metadata', async () => {
		const wired = wiredConnector();
		const executor = deferredExecutor(wired.broadcast);
		const promise = resubmitOperation(deps(senderFor(executor)), {
			operation: stuck(),
			operationKey: 'op-1',
			gasPrice,
		});
		await executor.release('0xnew');
		expect(await promise).toEqual({status: 'submitted'});

		// Attached, to the right operation.
		expect(wired.created).toHaveLength(0);
		expect(wired.attached).toHaveLength(1);
		expect(wired.attached[0].operationId).toBe('op-1');

		// The marker travelled as a SIBLING of metadata, and metadata is clean.
		const request = executor.requests[0];
		expect(request.correlation).toBe('op-1');
		expect(request.metadata).toEqual({
			type: 'unknown',
			name: 'Resubmit Transaction',
			data: [],
		});
		expect(request.metadata).not.toHaveProperty('operationId');
	});
});

describe('two replacements in flight at the same (from, nonce)', () => {
	/**
	 * THE CASE THE OLD MAP GOT WRONG, and the reason `correlation` exists.
	 *
	 * Two operations can share a nonce by design: cancelling or replacing a
	 * stuck transaction creates a second operation at that same nonce. A map
	 * keyed on `from:nonce` therefore has ONE slot for both, so the second
	 * write overwrote the first and whichever broadcast arrived first consumed
	 * a marker pointing at the wrong operation.
	 *
	 * Here both sends are opened before either is released, and they are
	 * released in the OPPOSITE order, which is what a user confirming two
	 * wallet popups out of order produces. Each attempt must land on the
	 * operation that issued it.
	 */
	it('attaches each broadcast to the operation that issued it', async () => {
		const wired = wiredConnector();
		const executor = deferredExecutor(wired.broadcast);
		const senders = senderFor(executor);

		// Both in flight, same account, same nonce, different operations.
		const first = resubmitOperation(deps(senders), {
			operation: stuck(4),
			operationKey: 'op-A',
			gasPrice,
		});
		const second = resubmitOperation(deps(senders), {
			operation: stuck(4),
			operationKey: 'op-B',
			gasPrice,
		});
		await vi.waitFor(() => expect(executor.requests).toHaveLength(2));

		// Released in send order, then the other. (`release` takes the oldest
		// still-open send, so this is A then B.)
		await executor.release('0xaaa');
		await executor.release('0xbbb');
		await Promise.all([first, second]);

		expect(wired.created).toHaveLength(0);
		expect(wired.attached).toHaveLength(2);

		// THE ASSERTION. Each hash on its own operation, neither on both.
		const routed = Object.fromEntries(
			wired.attached.map((a) => [a.tx.hash, a.operationId]),
		);
		expect(routed).toEqual({'0xaaa': 'op-A', '0xbbb': 'op-B'});
	});

	it('is unaffected by the order the wallets are confirmed in', async () => {
		// Same two sends, but the SECOND is confirmed first. Nothing about the
		// routing may depend on the order, because nothing about it is a queue.
		const wired = wiredConnector();
		const pending: Record<string, unknown>[] = [];
		const resolvers: (() => void)[] = [];
		const executor: ExecutorState = {
			status: 'ready',
			address: PAYER,
			account: PAYER,
			client: {
				sendTransaction: vi.fn((request: Record<string, unknown>) => {
					pending.push(request);
					return new Promise<string>((resolve) =>
						resolvers.push(() => resolve('0xok')),
					);
				}),
			} as never,
		};
		const senders = senderFor(executor);

		const first = resubmitOperation(deps(senders), {
			operation: stuck(4),
			operationKey: 'op-A',
			gasPrice,
		});
		const second = resubmitOperation(deps(senders), {
			operation: stuck(4),
			operationKey: 'op-B',
			gasPrice,
		});
		await vi.waitFor(() => expect(pending).toHaveLength(2));

		// B confirms first.
		wired.broadcast(broadcastEventFor(pending[1], '0xbbb'));
		resolvers[1]();
		wired.broadcast(broadcastEventFor(pending[0], '0xaaa'));
		resolvers[0]();
		await Promise.all([first, second]);

		expect(
			Object.fromEntries(wired.attached.map((a) => [a.tx.hash, a.operationId])),
		).toEqual({'0xbbb': 'op-B', '0xaaa': 'op-A'});
	});
});

describe('sends that carry no correlation', () => {
	it('creates an operation for an ordinary broadcast', () => {
		// `correlation` is `string | undefined` and undefined is the ORDINARY
		// case: every normal send has none. Handled, never asserted.
		const wired = wiredConnector();
		wired.broadcast({
			hash: '0x1',
			from: PAYER,
			nonce: 1,
			metadata: {type: 'unknown', name: 'Send', data: []},
		});

		expect(wired.attached).toHaveLength(0);
		expect(wired.created).toHaveLength(1);
	});

	it('creates a SEPARATE operation for a cancel', async () => {
		// A cancel deliberately sends no correlation. Attaching it would make the
		// stuck operation report the cancel's Success, and account data deletes an
		// operation that reports final success, so the transaction the user was
		// cancelling would announce that it succeeded and vanish from their list.
		const wired = wiredConnector();
		const executor = deferredExecutor(wired.broadcast);
		const promise = cancelOperation(deps(senderFor(executor)), {
			operation: stuck(),
		});
		await executor.release('0xcancel');
		expect(await promise).toEqual({status: 'submitted'});

		expect(wired.attached).toHaveLength(0);
		expect(wired.created).toHaveLength(1);
		expect(wired.created[0].correlation).toBeUndefined();
		expect(wired.created[0].metadata.name).toBe('Cancel Transaction');
		// At the same nonce as the operation it cancels, which is precisely why
		// nothing may infer the link from `(from, nonce)`.
		expect(wired.created[0].nonce).toBe(4);
	});
});

describe('a correlation naming an operation that is gone', () => {
	it('records the transaction anyway, rather than dropping it', async () => {
		// Reachable: account data deletes an operation the moment it finalizes
		// successfully, which can happen between the send and the broadcast. The
		// transaction is on chain either way, so filing it as a new operation is
		// imperfect and losing it entirely is worse.
		const wired = wiredConnector({existingOperations: new Set()});
		const executor = deferredExecutor(wired.broadcast);
		const promise = resubmitOperation(deps(senderFor(executor)), {
			operation: stuck(),
			operationKey: 'op-vanished',
			gasPrice,
		});
		await executor.release('0xnew');
		await promise;

		expect(wired.attached).toHaveLength(0);
		expect(wired.created).toHaveLength(1);
		expect(wired.created[0].hash).toBe('0xnew');
	});
});
