import {describe, it, expect} from 'vitest';
import {
	OPERATIONS_SCHEMA_VERSION,
	upgradeOperation,
	upgradeStoredOperations,
} from '../../../src/lib/account/operations-migration';
import {toTransactionIntent} from '../../../src/lib/account/operation-intent';
import {collectRecordedNonces} from '../../../src/lib/account/recorded-nonces';
import {deriveMinGasPrice} from '../../../src/lib/ui/pending-operation/operation-actions';
import {isKnownSource} from '../../../src/lib/core/connection/tx-source';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import v1Record from '../../fixtures/operations-v1-record.json';

/**
 * THE FIXTURE IS REAL, NOT WRITTEN BY HAND.
 *
 * `test/fixtures/operations-v1-record.json` was CAPTURED VERBATIM out of
 * localStorage by running the PREVIOUS build (commit 928f37f) through its own
 * `createAccountData`: a broadcast, a resubmit appended to the same operation,
 * an observer state update, and a second ordinary single-attempt operation.
 * Nothing in it was typed by hand, which is the point: a fixture invented from
 * the type would test the migration against my belief about the old shape
 * rather than against the shape users actually have on disk. It carries the
 * quirks that belief would have missed, and they are the ones that bite:
 *
 * - `metadata` SPREADS the transaction's metadata and ALSO nests `tx`, whose
 *   own `metadata` is a second copy of the same object (the runtime wrote
 *   `tx: transaction` under a type declaring `Omit<..., 'metadata'>`).
 * - bigints are `"0n"`-style STRINGS on disk; the JSON import therefore keeps
 *   them as strings and the migration must not care either way, because it
 *   moves values rather than reading them.
 * - the resubmitted attempt exists ONLY in `transactionIntent.transactions`
 *   and carries NO gas parameters at all.
 * - `deleteAt` sits on the operation and is synqable's retention deadline.
 *
 * Regenerate it the same way if the old shape is ever in doubt; do not edit it.
 */
const v1 = () => structuredClone(v1Record) as unknown;

/** The operation with two attempts (a broadcast plus a resubmit). */
const RESUBMITTED = '1739000000000';
/** The ordinary one: a single broadcast, still in the mempool. */
const ORDINARY = '1739000000001';

const HASH_1 =
	'0x1111111111111111111111111111111111111111111111111111111111111111';
const HASH_2 =
	'0x2222222222222222222222222222222222222222222222222222222222222222';
const HASH_3 =
	'0x3333333333333333333333333333333333333333333333333333333333333333';

function migrate(): Record<string, OnchainOperation> {
	return upgradeStoredOperations(v1()).data.operations;
}

describe('the v1 -> v2 upgrade, against a record the previous build wrote', () => {
	it('stamps the envelope with the new schema version', () => {
		const upgraded = upgradeStoredOperations(v1());
		expect(upgraded.$version).toBe(OPERATIONS_SCHEMA_VERSION);
		expect(OPERATIONS_SCHEMA_VERSION).toBe(2);
	});

	it('keeps synqable\u2019s own bookkeeping intact', () => {
		// The envelope carries per-item timestamps and tombstones that are not
		// ours to rewrite. Losing them would resurrect deleted operations.
		const upgraded = upgradeStoredOperations(v1()) as never as {
			$itemTimestamps: unknown;
			$tombstones: unknown;
		};
		expect(upgraded.$itemTimestamps).toEqual(
			(v1Record as never as {$itemTimestamps: unknown}).$itemTimestamps,
		);
		expect(upgraded.$tombstones).toEqual(
			(v1Record as never as {$tombstones: unknown}).$tombstones,
		);
	});

	it('moves metadata.tx into `call`, and leaves nothing of it in metadata', () => {
		const op = migrate()[RESUBMITTED];

		expect(op.call).toMatchObject({
			from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
			to: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
			data: expect.stringContaining('0xa4136862'),
			chainId: 31337,
			source: {route: 'account', wallet: {name: 'Rabby'}},
		});

		// METADATA IS NOW ONLY WHAT THE TRANSACTION MEANS. The old record nested
		// the whole tracked transaction under `metadata.tx`, which is how the
		// same transaction came to exist twice in one record.
		expect(op.metadata).toEqual({
			type: 'functionCall',
			functionName: 'setMessage',
			args: ['hey!!'],
		});
		expect(op.metadata).not.toHaveProperty('tx');
	});

	it('drops `operationId`, which is plumbing and never meant what it said', () => {
		// The old resubmit stamped it into metadata to tell the broadcast handler
		// to attach rather than create; it is an in-memory correlation now, so a
		// stored record must not carry one at all.
		for (const op of Object.values(migrate())) {
			expect(op.metadata).not.toHaveProperty('operationId');
		}
		expect(JSON.stringify(migrate())).not.toContain('operationId');
	});

	it('turns both broadcasts into attempts, in their dispatch order', () => {
		const op = migrate()[RESUBMITTED];
		expect(op.attempts.map((a) => a.hash)).toEqual([HASH_1, HASH_2]);
		expect(op.attempts.map((a) => a.nonce)).toEqual([12, 12]);
		expect(op.attempts.map((a) => a.broadcastTimestampMs)).toEqual([
			1739000000123, 1739000060456,
		]);
	});

	it('gives the dispatched attempt its gas parameters and the other none', () => {
		// Only the attempt `metadata.tx` describes ever had them recorded. The
		// resubmit existed solely inside the intent's transactions array.
		const op = migrate()[RESUBMITTED];
		expect(op.attempts[0].gasParameters).toEqual({
			gas: '100000n',
			maxFeePerGas: '1500000000n',
			maxPriorityFeePerGas: '1000000000n',
		});
		expect(op.attempts[0].txType).toBe('eip1559');
		expect(op.attempts[1].gasParameters).toEqual({});
		expect(op.attempts[1].txType).toBeUndefined();
	});

	it('moves each transaction state onto the attempt with the same hash', () => {
		const op = migrate()[RESUBMITTED];
		expect(op.attempts[0].state).toEqual({inclusion: 'NotFound'});
		expect(op.attempts[1].state).toEqual({
			inclusion: 'Included',
			outcome: 'Failure',
			final: true,
			blockTimestamp: 1739000100,
		});
	});

	it('rewrites the intent state for 0.2.0', () => {
		const op = migrate()[RESUBMITTED];
		expect(op.state).toEqual({
			inclusion: 'Included',
			// `status` was renamed.
			outcome: 'Failure',
			// `final` held the inclusion block's TIMESTAMP and its presence was the
			// finality flag. It is now the flag, and the timestamp has its own
			// field, in the chain's own seconds.
			final: true,
			blockTimestamp: 1739000100,
			// `attemptIndex` is now an arm of a discriminated union.
			via: {kind: 'attempt', attemptIndex: 1},
		});
	});

	it('carries a pending operation across untouched but for the rename', () => {
		const op = migrate()[ORDINARY];
		expect(op.state).toEqual({inclusion: 'InMemPool'});
		expect(op.attempts).toHaveLength(1);
		expect(op.attempts[0]).toMatchObject({
			hash: HASH_3,
			nonce: 13,
			gasParameters: {gas: '21000n', gasPrice: '1200000000n'},
			txType: 'legacy',
			state: {inclusion: 'InMemPool'},
		});
		expect(op.metadata).toEqual({type: 'unknown', name: 'Send', data: []});
	});

	it('never invents `nonceObserved`', () => {
		// Absent means false, which is the truth: the previous build never read a
		// nonce back off the chain. A fabricated `true` would let a supplied
		// nonce declare a transaction Dropped on the strength of nothing.
		expect(JSON.stringify(migrate())).not.toContain('nonceObserved');
		for (const tx of toTransactionIntent(migrate()[RESUBMITTED]).transactions) {
			expect(tx.nonceObserved).toBeUndefined();
		}
	});

	it('keeps synqable\u2019s retention deadline on each operation', () => {
		for (const op of Object.values(migrate())) {
			expect((op as never as {deleteAt: number}).deleteAt).toBe(1739604800000);
		}
	});

	it('is idempotent, so a second pass cannot eat a migrated record', () => {
		const once = migrate();
		const twice = upgradeStoredOperations(upgradeStoredOperations(v1())).data
			.operations;
		expect(twice).toEqual(once);
	});
});

describe('what the rest of the app can do with a migrated record', () => {
	it('hands reconciliation the nonces it used to read off transactions', () => {
		// The whole reason both read paths must migrate: this is what turns "a
		// transaction landed at this nonce" into "and you can see it in your
		// list". Reading a v1 record with the v2 code returns nothing.
		// Filtered by sender, which is this variant's addition to the collector:
		// the list is keyed by the authenticated player and holds whatever any of
		// its senders did on their behalf.
		const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
		expect(collectRecordedNonces(migrate(), ACCOUNT).sort()).toEqual([
			12, 12, 13,
		]);
	});

	it('leaves the replacement path able to find the route that signed it', () => {
		expect(isKnownSource(migrate()[RESUBMITTED].call.source)).toBe(true);
		expect(migrate()[RESUBMITTED].call.source.route).toBe('account');
	});

	it('projects to an intent whose transactions still line up with their state', () => {
		const intent = toTransactionIntent(migrate()[RESUBMITTED]);
		expect(intent.transactions.map((tx) => tx.hash)).toEqual([HASH_1, HASH_2]);
		expect(intent.transactions[1].state).toMatchObject({
			inclusion: 'Included',
			outcome: 'Failure',
		});
		// And the intent state points at the transaction that actually won.
		expect(
			intent.state?.inclusion === 'Included' &&
				intent.state.via.kind === 'attempt' &&
				intent.transactions[intent.state.via.attemptIndex].hash,
		).toBe(HASH_2);
	});
});

describe('records the fixture cannot cover', () => {
	/**
	 * Hand-written, and SAID SO. These are shapes the current build cannot
	 * produce, so they cannot be captured: a record from before `source`
	 * existed, and one whose winning attempt cannot be pointed at.
	 */
	it('leaves a pre-source record without a source, rather than inventing one', () => {
		const upgraded = upgradeOperation({
			metadata: {
				type: 'unknown',
				name: 'Old',
				data: [],
				tx: {
					hash: '0xaa',
					from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
					to: null,
					value: 0n,
					data: '0x',
					nonce: 1,
					broadcastTimestampMs: 5,
					gasParameters: {maxFeePerGas: 7n, maxPriorityFeePerGas: 1n},
				},
			},
			transactionIntent: {transactions: [{hash: '0xaa', nonce: 1}]},
		});

		expect(upgraded.call).not.toHaveProperty('source');
		// Which the replacement path already knows how to handle: it means "I do
		// not know which route sent this", and with a single sender it recovers.
		expect(isKnownSource(upgraded.call.source)).toBe(false);
		// And the record is otherwise entirely usable.
		expect(deriveMinGasPrice(upgraded)).toEqual({
			maxFeePerGas: 7n,
			maxPriorityFeePerGas: 1n,
		});
	});

	it('takes `from` off the transactions when metadata.tx has none', () => {
		// v1 records the sender TWICE, on `metadata.tx` and on every entry of
		// `transactionIntent.transactions`. Reading the second when the first is
		// missing costs nothing and closes a silent failure: a variant that sends
		// from more than one route filters its nonce scan by `call.from`, so an
		// operation migrated without one disappears from reconciliation and the
		// user is told a transaction may have been sent while it sits in
		// their list.
		const upgraded = upgradeOperation({
			metadata: {type: 'unknown', name: 'x', data: [], tx: {hash: '0xaa'}},
			transactionIntent: {
				transactions: [
					{
						hash: '0xaa',
						nonce: 1,
						from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
					},
				],
			},
		});

		expect(upgraded.call.from).toBe(
			'0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
		);
	});

	it('prefers metadata.tx when both say who sent it', () => {
		const upgraded = upgradeOperation({
			metadata: {
				type: 'unknown',
				name: 'x',
				data: [],
				tx: {hash: '0xaa', from: '0x1111111111111111111111111111111111111111'},
			},
			transactionIntent: {
				transactions: [
					{hash: '0xaa', from: '0x2222222222222222222222222222222222222222'},
				],
			},
		});

		expect(upgraded.call.from).toBe(
			'0x1111111111111111111111111111111111111111',
		);
	});

	it('reports an unpointable inclusion as pending rather than fabricating a `via`', () => {
		// `attemptIndex` named a transaction that is not in the list. 0.2.0's
		// Included arm REQUIRES a `via`, so there is no honest way to express
		// this; saying "in the mempool" costs one poll and claims nothing false.
		const upgraded = upgradeOperation({
			metadata: {type: 'unknown', name: 'x', data: [], tx: {hash: '0xaa'}},
			transactionIntent: {
				transactions: [{hash: '0xaa'}],
				state: {inclusion: 'Included', status: 'Success', attemptIndex: 4},
			},
		});
		expect(upgraded.state).toEqual({inclusion: 'InMemPool'});
	});

	it('re-points `attemptIndex` through the hash, not the number', () => {
		// The index addressed the OLD transactions array. Nothing guarantees the
		// new attempts array is in that order, and a number carried across blind
		// would name a different transaction as the winner.
		const upgraded = upgradeOperation({
			metadata: {
				type: 'unknown',
				name: 'x',
				data: [],
				// `metadata.tx` describes a broadcast the intent never listed, so it
				// is prepended and every old index shifts by one.
				tx: {hash: '0xzero', nonce: 1, broadcastTimestampMs: 1},
			},
			transactionIntent: {
				transactions: [{hash: '0xaa'}, {hash: '0xbb'}],
				state: {inclusion: 'Included', status: 'Success', attemptIndex: 1},
			},
		});

		expect(upgraded.attempts.map((a) => a.hash)).toEqual([
			'0xzero',
			'0xaa',
			'0xbb',
		]);
		expect(upgraded.state).toMatchObject({
			via: {kind: 'attempt', attemptIndex: 2},
		});
		// The point of doing it by hash: the winner is still 0xbb.
		expect(
			upgraded.state?.inclusion === 'Included' &&
				upgraded.state.via.kind === 'attempt' &&
				upgraded.attempts[upgraded.state.via.attemptIndex].hash,
		).toBe('0xbb');
	});

	it('reads a dropped record\u2019s finality without giving it a block time', () => {
		// The Dropped arm has no inclusion block, so it has no blockTimestamp
		// either, however the old record spelled its `final`.
		expect(
			upgradeOperation({
				metadata: {type: 'unknown', name: 'x', data: [], tx: {hash: '0xaa'}},
				transactionIntent: {
					transactions: [{hash: '0xaa'}],
					state: {inclusion: 'Dropped', final: 1739000100},
				},
			}).state,
		).toEqual({inclusion: 'Dropped', final: true});

		expect(
			upgradeOperation({
				metadata: {type: 'unknown', name: 'x', data: [], tx: {hash: '0xaa'}},
				transactionIntent: {
					transactions: [{hash: '0xaa'}],
					state: {inclusion: 'Dropped'},
				},
			}).state,
		).toEqual({inclusion: 'Dropped', final: false});
	});
});
