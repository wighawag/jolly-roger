import {describe, it, expect, vi, beforeEach} from 'vitest';
import {readable} from 'svelte/store';
import {
	resubmitOperation,
	cancelOperation,
} from '../../../src/lib/ui/pending-operation/operation-actions';
import {createTrackedWalletConnector} from '../../../src/lib/account/connectors';
import {takeResubmitTarget} from '../../../src/lib/account/resubmit-correlation';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import type {Sender} from '../../../src/lib/core/connection/senders';
import type {ExecutorState} from '../../../src/lib/core/connection/executor';

/**
 * HOW A REPLACEMENT FINDS ITS OPERATION, NOW THAT METADATA DOES NOT CARRY IT.
 *
 * The resubmit used to stamp `operationId` into the tracker's METADATA and the
 * broadcast handler branched on it. Metadata is what the app says a transaction
 * MEANS; an operation id is plumbing, and it ended up persisted in every
 * resubmitted record. It is an in-memory correlation now: `from:nonce` written
 * immediately before the send, read and deleted by the handler.
 *
 * The two cases that matter are the two ends of the same key. A RESUBMIT must
 * attach; a CANCEL must not. Both reuse the stuck transaction's nonce, so they
 * are indistinguishable by `(from, nonce)`, which is exactly why the store is
 * not consulted: a cancel attached to the operation it cancels would make that
 * operation report the cancel's Success, and account data deletes an operation
 * that reports final success. The stuck transaction would announce that it
 * SUCCEEDED and vanish.
 */

const PAYER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;
const GREETER = '0x5fbdb2315678afecb367f032d93f642f64180aa3' as `0x${string}`;
const HASH_NEW =
	'0x4444444444444444444444444444444444444444444444444444444444444444' as const;

/** Records the transaction the tracker would emit for whatever was sent. */
function executorRecording(broadcast: (tx: unknown) => void): ExecutorState {
	return {
		status: 'ready',
		address: PAYER,
		account: PAYER,
		client: {
			sendTransaction: vi.fn(async (request: Record<string, unknown>) => {
				// The tracker emits `transaction:broadcasted` from INSIDE the send,
				// before it returns the hash. Modelled faithfully, because the whole
				// design rests on where that emit sits relative to the send.
				broadcast({
					known: false,
					hash: HASH_NEW,
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
				});
				return HASH_NEW;
			}),
		} as never,
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

/** The stuck operation being replaced. */
const stuck = (): OnchainOperation =>
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
				nonce: 4,
				broadcastTimestampMs: 1,
				gasParameters: {maxFeePerGas: 10n, maxPriorityFeePerGas: 1n},
			},
		],
	}) as unknown as OnchainOperation;

/** Account data reduced to which of the two filing calls was made. */
function recordingAccountData() {
	const attached: {operationId: string; tx: unknown}[] = [];
	const created: unknown[] = [];
	return {
		attached,
		created,
		accountData: {
			addTransactionToOperation: (operationId: string, tx: unknown) =>
				attached.push({operationId, tx}),
			addOperationFromTrackedTransaction: (tx: unknown) => created.push(tx),
			updateOperationFromFetchedTransaction: () => {},
		} as never,
	};
}

/** The real broadcast connector, wired to a client we drive by hand. */
function wiredConnector() {
	const listeners = new Set<(tx: unknown) => void>();
	const {attached, created, accountData} = recordingAccountData();
	const connector = createTrackedWalletConnector({
		walletClient: {
			on: (event: string, listener: (tx: unknown) => void) => {
				if (event === 'transaction:broadcasted') listeners.add(listener);
				return () => listeners.delete(listener);
			},
		} as never,
		accountData,
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

beforeEach(() => {
	// The map is module state, and a marker leaking between tests would make a
	// later cancel look like it attached. Drained, not reset, so this also
	// asserts that each test left nothing behind.
	takeResubmitTarget({from: PAYER, nonce: 4});
});

describe('a resubmit', () => {
	it('attaches to its operation, with no marker in the metadata', async () => {
		const wired = wiredConnector();
		const senders = senderFor(executorRecording(wired.broadcast));

		const result = await resubmitOperation(deps(senders), {
			operation: stuck(),
			operationKey: 'op-1',
			gasPrice: {maxFeePerGas: 30n, maxPriorityFeePerGas: 2n},
		});

		expect(result).toEqual({status: 'submitted'});

		// ATTACHED, to the right operation.
		expect(wired.attached).toHaveLength(1);
		expect(wired.attached[0].operationId).toBe('op-1');
		expect(wired.created).toHaveLength(0);

		// AND THE METADATA IS CLEAN. This is the assertion that fails the day
		// somebody reaches for the old shortcut: the id must not be in there, and
		// it must not be anywhere else in the transaction either, because
		// everything on it is persisted.
		const metadata = (wired.attached[0].tx as {metadata: object}).metadata;
		expect(metadata).toEqual({
			type: 'unknown',
			name: 'Resubmit Transaction',
			data: [],
		});
		expect(metadata).not.toHaveProperty('operationId');
		// Nowhere else on the transaction either: everything on it is persisted.
		// (`bigIntReplacer`-style, because gas parameters are bigints.)
		expect(
			JSON.stringify(wired.attached[0].tx, (_key, value) =>
				typeof value === 'bigint' ? value.toString() : value,
			),
		).not.toContain('op-1');
	});

	it('consumes its marker, so the NEXT send at that nonce creates', async () => {
		const wired = wiredConnector();
		const senders = senderFor(executorRecording(wired.broadcast));

		await resubmitOperation(deps(senders), {
			operation: stuck(),
			operationKey: 'op-1',
			gasPrice: {maxFeePerGas: 30n, maxPriorityFeePerGas: 2n},
		});
		expect(wired.attached).toHaveLength(1);

		// A second, unrelated broadcast at the same nonce. A marker left behind
		// would silently file it into the operation above.
		wired.broadcast({
			hash: '0x5555',
			from: PAYER,
			nonce: 4,
			metadata: {type: 'unknown', name: 'Something else', data: []},
		});

		expect(wired.attached).toHaveLength(1);
		expect(wired.created).toHaveLength(1);
	});

	it('forgets the marker when the send fails, rather than arming the next one', async () => {
		const rejecting: ExecutorState = {
			status: 'ready',
			address: PAYER,
			account: PAYER,
			client: {
				sendTransaction: vi.fn(async () => {
					throw {code: 4001, message: 'User rejected the request'};
				}),
			} as never,
		};

		const result = await resubmitOperation(deps(senderFor(rejecting)), {
			operation: stuck(),
			operationKey: 'op-1',
			gasPrice: {maxFeePerGas: 30n, maxPriorityFeePerGas: 2n},
		});
		expect(result).toMatchObject({status: 'error'});

		// Nothing consumed it, so it must have been swept: a stale marker would
		// attach an unrelated later transaction to an operation it has nothing to
		// do with.
		expect(takeResubmitTarget({from: PAYER, nonce: 4})).toBeUndefined();
	});

	it('matches whatever spelling of the address each end used', async () => {
		// The stored operation can carry a checksummed address while the tracker
		// reports the provider's lowercase one. Same account, two strings, and a
		// miss files the replacement as a brand new operation.
		const wired = wiredConnector();
		const senders = senderFor(executorRecording(wired.broadcast));
		const operation = stuck();
		(operation.call as {from: string}).from = PAYER.toUpperCase().replace(
			'0X',
			'0x',
		);

		await resubmitOperation(deps(senders), {
			operation,
			operationKey: 'op-1',
			gasPrice: {maxFeePerGas: 30n, maxPriorityFeePerGas: 2n},
		});

		expect(wired.attached.map((a) => a.operationId)).toEqual(['op-1']);
	});
});

describe('a cancel', () => {
	it('creates its own operation and never attaches to the one it cancels', async () => {
		// THE FAILURE THIS PREVENTS: attaching would make the stuck operation
		// report the cancel's Success, and account data deletes an operation that
		// reports final success. The transaction the user was getting rid of would
		// announce that it succeeded and disappear from their list.
		const wired = wiredConnector();
		const senders = senderFor(executorRecording(wired.broadcast));

		const result = await cancelOperation(deps(senders), {
			operation: stuck(),
		});

		expect(result).toEqual({status: 'submitted'});
		expect(wired.attached).toHaveLength(0);
		expect(wired.created).toHaveLength(1);
		expect((wired.created[0] as {metadata: {name: string}}).metadata.name).toBe(
			'Cancel Transaction',
		);
		// At the same nonce, which is the whole reason it could have been confused
		// with a resubmit by anything that inferred the link from the store.
		expect((wired.created[0] as {nonce: number}).nonce).toBe(4);
	});
});
