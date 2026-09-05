import {describe, it, expect, vi} from 'vitest';
import {readable} from 'svelte/store';
import {createAccountData} from '../../../src/lib/account/AccountData';
import {toTransactionIntent} from '../../../src/lib/account/operation-intent';
import {deriveMinGasPrice} from '../../../src/lib/ui/pending-operation/operation-actions';
import {isKnownSource} from '../../../src/lib/core/connection/tx-source';
import type {TypedDeployments} from '../../../src/lib/core/connection/types';

/**
 * THE BUG THE RESTRUCTURE EXISTS TO PREVENT, PINNED.
 *
 * `updateOperationFromTransactionStateUpdated` used to rebuild the stored
 * transactions as `[...event.intent.transactions]` plus whatever local entries
 * the observer did not have. That is a WHOLESALE REPLACE dressed as a merge:
 * everything the observer was never told about went with it. In the old shape
 * the dispatch facts lived in a sibling field so they survived by luck; the
 * moment they live where the observer writes, they do not.
 *
 * So this applies a real observer update to a real operation in a real store
 * and asserts the dispatch facts are still there afterwards. Without it, the
 * next person re-introduces the merge, every test still passes, and a user
 * discovers it when a stuck transaction turns out to be unreplaceable because
 * its gas parameters and its route are gone.
 *
 * Runs in the browser project because `createAccountData` needs a real
 * localStorage: the point is the round trip through the actual store, not
 * through a hand-held object.
 */

const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const SCOPE = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0' as const;
const GREETER = '0x5fbdb2315678afecb367f032d93f642f64180aa3' as const;

const HASH_1 =
	'0x1111111111111111111111111111111111111111111111111111111111111111';
const HASH_2 =
	'0x2222222222222222222222222222222222222222222222222222222222222222';

const deployments = {
	chain: {id: 31337, genesisHash: '0xgenesis'},
} as unknown as TypedDeployments;

/** A broadcast, exactly as @etherkit/viem-tx-tracker emits it. */
function broadcast(overrides: Record<string, unknown> = {}) {
	return {
		known: false,
		hash: HASH_1,
		from: ACCOUNT,
		to: GREETER,
		value: 0n,
		data: '0xa4136862deadbeef',
		nonce: 12,
		chainId: 31337,
		broadcastTimestampMs: 1739000000123,
		txType: 'eip1559',
		gasParameters: {
			gas: 100000n,
			maxFeePerGas: 1500000000n,
			maxPriorityFeePerGas: 1000000000n,
		},
		source: {route: 'account', wallet: {name: 'Rabby'}},
		metadata: {type: 'functionCall', functionName: 'setMessage', args: ['hi']},
		...overrides,
	} as never;
}

async function readyStore() {
	localStorage.clear();
	const accountData = createAccountData({
		accountStore: readable<`0x${string}` | undefined>(ACCOUNT),
		deployments,
		clock: {now: () => 1739000000000} as never,
		scopeAddress: SCOPE,
	});
	const stop = accountData.subscribe(() => {});
	await vi.waitFor(() => expect(accountData.isReady()).toBe(true));
	const operations = () =>
		(
			accountData.get()!.get() as never as {
				data: {operations: Record<string, never>};
			}
		).data.operations;
	return {accountData, stop, operations};
}

describe('an observer update against a stored operation', () => {
	it('keeps every dispatch fact the observer was never told about', async () => {
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(broadcast());
			const id = Object.keys(operations())[0];

			// What the observer sends back: the intent it was fed, with state on it.
			// Note what it does NOT carry, and never did: gas parameters, the
			// source route, the calldata. Those are the app's.
			accountData.updateOperationFromTransactionStateUpdated({
				id,
				intent: {
					transactions: [
						{
							hash: HASH_1,
							from: ACCOUNT,
							nonce: 12,
							broadcastTimestampMs: 1739000000123,
							nonceObserved: true,
							state: {inclusion: 'Included', outcome: 'Success', final: false},
						},
					],
					state: {
						inclusion: 'Included',
						outcome: 'Success',
						final: false,
						blockTimestamp: 1739000100,
						via: {kind: 'attempt', attemptIndex: 0},
					},
				},
			} as never);

			const op = operations()[id] as never as {
				call: Record<string, unknown>;
				attempts: Record<string, unknown>[];
				metadata: Record<string, unknown>;
				state: Record<string, unknown>;
			};

			// THE DISPATCH FACTS. Each of these was reachable only through the
			// field the observer's array replaced.
			expect(op.attempts[0].gasParameters).toEqual({
				gas: 100000n,
				maxFeePerGas: 1500000000n,
				maxPriorityFeePerGas: 1000000000n,
			});
			expect(op.call.source).toEqual({
				route: 'account',
				wallet: {name: 'Rabby'},
			});
			expect(op.call.data).toBe('0xa4136862deadbeef');
			expect(op.call.to).toBe(GREETER);
			expect(op.call.value).toBe(0n);
			expect(op.attempts[0].txType).toBe('eip1559');
			expect(op.attempts[0].nonce).toBe(12);
			expect(op.metadata).toEqual({
				type: 'functionCall',
				functionName: 'setMessage',
				args: ['hi'],
			});

			// And the two things the observer DOES own did land.
			expect(op.state).toMatchObject({
				inclusion: 'Included',
				outcome: 'Success',
				via: {kind: 'attempt', attemptIndex: 0},
			});
			expect(op.attempts[0].state).toEqual({
				inclusion: 'Included',
				outcome: 'Success',
				final: false,
			});

			// Stated as the consumers see it, not just as fields: the replacement
			// path must still be able to price and route a replacement.
			const stored = operations()[id] as never;
			expect(deriveMinGasPrice(stored)).toEqual({
				maxFeePerGas: 1500000000n,
				maxPriorityFeePerGas: 1000000000n,
			});
			expect(
				isKnownSource((stored as {call: {source: never}}).call.source),
			).toBe(true);
		} finally {
			stop();
		}
	});

	it('keeps the attempts the app owns, and adopts no transaction of its own', async () => {
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(broadcast());
			const id = Object.keys(operations())[0];
			accountData.addTransactionToOperation(
				id,
				broadcast({
					hash: HASH_2,
					broadcastTimestampMs: 1739000060456,
					gasParameters: {
						gas: 100000n,
						maxFeePerGas: 3000000000n,
						maxPriorityFeePerGas: 2000000000n,
					},
				}),
			);

			// An update that mentions only ONE of the two, and also a hash we never
			// sent. The observer cannot actually do either (it is fed from this
			// store), which is exactly why the app must not try to reconcile: it
			// patches what it recognises and adopts nothing.
			accountData.updateOperationFromTransactionStateUpdated({
				id,
				intent: {
					transactions: [
						{
							hash: HASH_2,
							from: ACCOUNT,
							nonce: 12,
							broadcastTimestampMs: 1739000060456,
							state: {inclusion: 'InMemPool'},
						},
						{
							hash: '0x9999999999999999999999999999999999999999999999999999999999999999',
							from: ACCOUNT,
							nonce: 99,
							broadcastTimestampMs: 1,
							state: {inclusion: 'Included', outcome: 'Success', final: true},
						},
					],
					state: {inclusion: 'InMemPool'},
				},
			} as never);

			const op = operations()[id] as never as {
				attempts: {hash: string; state?: unknown; gasParameters: unknown}[];
			};

			// Both of ours, still ours, in order.
			expect(op.attempts.map((a) => a.hash)).toEqual([HASH_1, HASH_2]);
			// The one it spoke about got its state; the other kept what it had.
			expect(op.attempts[1].state).toEqual({inclusion: 'InMemPool'});
			expect(op.attempts[0].state).toBeUndefined();
			// The unknown hash was NOT adopted: that would be inventing an attempt
			// this app never made, at a nonce it never used.
			expect(op.attempts).toHaveLength(2);
			// And the second attempt's own gas parameters survived, which is what
			// the replacement floor is computed from.
			expect(op.attempts[1].gasParameters).toMatchObject({
				maxFeePerGas: 3000000000n,
			});
		} finally {
			stop();
		}
	});

	it('deletes the operation once it reports final success, as before', async () => {
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(broadcast());
			const id = Object.keys(operations())[0];

			accountData.updateOperationFromTransactionStateUpdated({
				id,
				intent: {
					transactions: [{hash: HASH_1, from: ACCOUNT, nonce: 12}],
					// `outcome`, not `status`: reading the old name here would leave
					// finished operations in the list forever.
					state: {
						inclusion: 'Included',
						outcome: 'Success',
						final: true,
						via: {kind: 'attempt', attemptIndex: 0},
					},
				},
			} as never);

			expect(operations()[id]).toBeUndefined();
		} finally {
			stop();
		}
	});
});

describe('the projection the observer is fed', () => {
	it('round-trips a stored operation into an intent', async () => {
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(broadcast());
			const id = Object.keys(operations())[0];
			accountData.addTransactionToOperation(
				id,
				broadcast({hash: HASH_2, broadcastTimestampMs: 1739000060456}),
			);

			const intent = toTransactionIntent(operations()[id] as never);

			// One entry per broadcast, each carrying what a BroadcastedTransaction
			// is: the hash, who sent it, at which nonce, when, on which chain.
			expect(intent.transactions).toEqual([
				{
					chainId: 31337,
					from: ACCOUNT,
					hash: HASH_1,
					nonce: 12,
					broadcastTimestampMs: 1739000000123,
					state: undefined,
				},
				{
					chainId: 31337,
					from: ACCOUNT,
					hash: HASH_2,
					nonce: 12,
					broadcastTimestampMs: 1739000060456,
					state: undefined,
				},
			]);
			expect(intent.state).toBeUndefined();
			// Never fabricated: only the observer may say a nonce came off chain.
			for (const tx of intent.transactions) {
				expect(tx).not.toHaveProperty('nonceObserved');
			}
		} finally {
			stop();
		}
	});

	it('survives the observer round trip: project, update, project again', async () => {
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(broadcast());
			const id = Object.keys(operations())[0];

			// Exactly the loop production runs: the store is projected into the
			// observer, the observer answers with an event, the answer is written
			// back, and the next projection must still be a valid intent.
			const fed = toTransactionIntent(operations()[id] as never);
			accountData.updateOperationFromTransactionStateUpdated({
				id,
				intent: {
					...fed,
					transactions: fed.transactions.map((tx) => ({
						...tx,
						state: {inclusion: 'InMemPool'},
					})),
					state: {inclusion: 'InMemPool'},
				},
			} as never);

			const again = toTransactionIntent(operations()[id] as never);
			expect(again.transactions).toHaveLength(1);
			expect(again.transactions[0].hash).toBe(HASH_1);
			expect(again.transactions[0].state).toEqual({inclusion: 'InMemPool'});
			expect(again.state).toEqual({inclusion: 'InMemPool'});
		} finally {
			stop();
		}
	});
});

/**
 * THE PROJECTION, HANDED TO THE REAL OBSERVER.
 *
 * The tests above check the projection's SHAPE. This checks that the shape is
 * one `@etherkit/tx-observer` actually accepts and can work with: it is fed a
 * projected operation, told to process against a stub chain, and its answer is
 * written back through the same handler production uses. If the projection ever
 * drifts from what the library wants, this fails here rather than in a browser
 * with a transaction stuck reporting nothing.
 */
describe('a projected operation, through the real observer', () => {
	it('is accepted, processed and written back', async () => {
		const {createTransactionObserver} = await import('@etherkit/tx-observer');
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(broadcast());
			const id = Object.keys(operations())[0];

			// A chain on which our transaction is mined, in a block deep enough to
			// be final at `finality: 2` (mined at 0x60 = 96, head at 0x64 = 100).
			const INCLUSION_BLOCK_HASH = '0xbbbb';
			const INCLUSION_TIMESTAMP = 0x67a9c2f4;
			const provider = {
				request: async ({
					method,
					params,
				}: {
					method: string;
					params?: unknown[];
				}) => {
					switch (method) {
						case 'eth_chainId':
							return '0x7a69';
						case 'eth_getBlockByNumber': {
							const tag = params?.[0] as string;
							const number = tag === 'latest' ? '0x64' : tag;
							return {
								number,
								timestamp: `0x${(INCLUSION_TIMESTAMP + 10).toString(16)}`,
								hash: '0xhead',
							};
						}
						case 'eth_getTransactionCount':
							return '0xd';
						case 'eth_getTransactionByHash':
							return {
								hash: HASH_1,
								nonce: '0xc',
								blockNumber: '0x60',
								blockHash: INCLUSION_BLOCK_HASH,
							};
						case 'eth_getTransactionReceipt':
							return {
								status: '0x1',
								blockNumber: '0x60',
								blockHash: INCLUSION_BLOCK_HASH,
							};
						case 'eth_getBlockByHash':
							return {
								number: '0x60',
								hash: INCLUSION_BLOCK_HASH,
								timestamp: `0x${INCLUSION_TIMESTAMP.toString(16)}`,
							};
						default:
							return null;
					}
				},
			};

			const observer = createTransactionObserver({
				finality: 2,
				provider: provider as never,
			});
			observer.on('intent:state', (event) =>
				accountData.updateOperationFromTransactionStateUpdated(event),
			);

			// EXACTLY WHAT THE CONNECTOR DOES: project, then add.
			observer.add(id, toTransactionIntent(operations()[id] as never));
			await observer.process();

			// The verdict travelled the whole loop: the observer understood the
			// projection, decided the transaction was included and final, the app
			// wrote that back, and account data swept the operation because a final
			// success is done. Nothing here is stubbed except the chain.
			expect(operations()[id]).toBeUndefined();
		} finally {
			stop();
		}
	});
});

/**
 * `correlation` IS EPHEMERAL PLUMBING AND MUST NOT BE PERSISTED.
 *
 * The tracker carries it on every emitted transaction, which means it arrives
 * on the same object the store's writers are handed. It says which caller-side
 * REQUEST a send answers, so it is meaningless the moment that session ends: a
 * value read back from storage refers to in-flight work that no longer exists.
 * `hash` is the durable identity, and it is what everything here keys on.
 *
 * The whole reason `correlation` exists is that the previous marker travelled
 * in `metadata` and therefore ended up in every stored record. Writing it into
 * the record under a new name would be the same mistake with better manners,
 * so it is asserted against the REAL store rather than trusted to review.
 */
describe('correlation and storage', () => {
	it('never reaches a stored record, on either write path', async () => {
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(
				broadcast({correlation: 'op-should-not-be-stored'}),
			);
			const id = Object.keys(operations())[0];
			accountData.addTransactionToOperation(
				id,
				broadcast({
					hash: HASH_2,
					broadcastTimestampMs: 1739000060456,
					correlation: 'also-not-stored',
				}),
			);

			const op = operations()[id] as never as Record<string, unknown>;
			expect(op).not.toHaveProperty('correlation');
			expect(op.metadata).not.toHaveProperty('correlation');
			expect(op.call).not.toHaveProperty('correlation');
			for (const attempt of op.attempts as Record<string, unknown>[]) {
				expect(attempt).not.toHaveProperty('correlation');
			}

			// And not anywhere in the serialised form either, which is the check
			// that survives someone adding a field without updating the ones above.
			await vi.waitFor(() => {
				const raw = localStorage.getItem(
					`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
				);
				expect(raw).toContain(HASH_2);
			});
			const raw = localStorage.getItem(
				`__private__31337_0xgenesis_${SCOPE}_${ACCOUNT}`,
			)!;
			expect(raw).not.toContain('correlation');
			expect(raw).not.toContain('op-should-not-be-stored');
			expect(raw).not.toContain('also-not-stored');
		} finally {
			stop();
		}
	});

	it('still records the attempt it was routing', async () => {
		// The point is that the marker is dropped, not the transaction.
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(
				broadcast({correlation: 'op-x'}),
			);
			const op = operations()[Object.keys(operations())[0]] as never as {
				attempts: {hash: string}[];
			};
			expect(op.attempts.map((a) => a.hash)).toEqual([HASH_1]);
		} finally {
			stop();
		}
	});
});

/**
 * IDEMPOTENCE OF THE `transaction:known` HANDLER.
 *
 * tx-tracker 0.2.0 fixed a bug where `sendRawTransaction` emitted a different
 * number of events depending on `populateMetadata`: under auto-populate (which
 * this app uses) the second event was missing, and now it fires. jolly-roger
 * does not currently issue raw sends, so nothing changes today, but the guard
 * in `core/transaction/dispatch-guard` wraps `sendRawTransaction` and a future
 * caller would get this event twice.
 *
 * The handler is safe by CONSTRUCTION rather than by luck: it locates its
 * operation BY HASH and patches that attempt in place, so a repeat writes the
 * same values again. It appends nothing, counts nothing, notifies nothing.
 * Asserted, so that a future edit which makes it append is caught here rather
 * than by a user seeing a duplicated attempt.
 */
describe('receiving transaction:known twice for the same transaction', () => {
	it('changes nothing the second time', async () => {
		const {accountData, stop, operations} = await readyStore();
		try {
			accountData.addOperationFromTrackedTransaction(broadcast());
			const id = Object.keys(operations())[0];

			const known = {
				...(broadcast() as never as Record<string, unknown>),
				known: true,
				nonce: 12,
				txType: 'eip1559',
				gasParameters: {
					gas: 90000n,
					maxFeePerGas: 1400000000n,
					maxPriorityFeePerGas: 900000000n,
				},
			};

			accountData.updateOperationFromKnownTransaction(known as never);
			const afterFirst = structuredClone(operations()[id] as never);

			accountData.updateOperationFromKnownTransaction(known as never);
			const afterSecond = operations()[id] as never as {
				attempts: unknown[];
			};

			// One attempt, not two, and byte-for-byte the same record.
			expect(afterSecond.attempts).toHaveLength(1);
			expect(afterSecond).toEqual(afterFirst);
		} finally {
			stop();
		}
	});
});
