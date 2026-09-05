import {describe, it, expect} from 'vitest';
import {
	getOperationName,
	getOperationStatusInfo,
	getMainTxHash,
	isIncludedAttempt,
	getTransactionResult,
	getEarliestBroadcastMs,
	getInclusionBadgeVariant,
	partitionOperationsBySender,
	getBlockTimestamp,
	formatBroadcastTime,
	formatBlockTime,
	countPendingOperations,
	sortAttemptsNewestFirst,
	sortOperationIdsDescending,
} from '../../../src/lib/view/operation';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import type {TransactionIntentState} from '@etherkit/tx-observer';

const op = (metadata: unknown): OnchainOperation =>
	({metadata}) as unknown as OnchainOperation;

/** An operation reduced to the fields the function under test reads. */
const operation = (partial: unknown): OnchainOperation =>
	partial as unknown as OnchainOperation;

const state = (partial: unknown): TransactionIntentState =>
	partial as unknown as TransactionIntentState;

describe('getOperationName', () => {
	it('reads functionCall / unknown names, else the fallback', () => {
		expect(
			getOperationName(op({type: 'functionCall', functionName: 'mint'})),
		).toBe('mint');
		expect(getOperationName(op({type: 'unknown', name: 'Resubmit'}))).toBe(
			'Resubmit',
		);
		expect(getOperationName(op({type: 'other'}))).toBe('Unknown Operation');
		expect(getOperationName(op({type: 'other'}), 'Transaction')).toBe(
			'Transaction',
		);
	});
});

describe('getOperationStatusInfo', () => {
	it('maps each inclusion/outcome to kind + label + variant', () => {
		expect(getOperationStatusInfo(undefined)).toMatchObject({kind: 'pending'});
		expect(
			getOperationStatusInfo(state({inclusion: 'InMemPool'})),
		).toMatchObject({kind: 'pending', variant: 'secondary'});
		expect(
			getOperationStatusInfo(state({inclusion: 'NotFound'})),
		).toMatchObject({kind: 'notFound', variant: 'destructive'});
		expect(getOperationStatusInfo(state({inclusion: 'Dropped'}))).toMatchObject(
			{
				kind: 'dropped',
			},
		);
		expect(
			getOperationStatusInfo(
				state({inclusion: 'Included', outcome: 'Success'}),
			),
		).toMatchObject({kind: 'success', label: 'Success', variant: 'default'});
		expect(
			getOperationStatusInfo(
				state({inclusion: 'Included', outcome: 'Failure'}),
			),
		).toMatchObject({kind: 'failed', variant: 'destructive'});
	});
});

describe('getMainTxHash', () => {
	it('returns undefined with no attempts', () => {
		expect(getMainTxHash(operation({attempts: []}))).toBeUndefined();
	});
	it('prefers the attempt the state points at', () => {
		const o = operation({
			attempts: [{hash: '0xa'}, {hash: '0xb'}],
			state: {
				inclusion: 'Included',
				via: {kind: 'attempt', attemptIndex: 1},
			},
		});
		expect(getMainTxHash(o)).toBe('0xb');
	});
	it('falls back to the first attempt', () => {
		const o = operation({attempts: [{hash: '0xa'}, {hash: '0xb'}]});
		expect(getMainTxHash(o)).toBe('0xa');
	});

	/**
	 * AN OUT-OF-BAND WIN HAS NO HASH OF OURS. The same action arrived from
	 * another device, or the user resubmitted in their wallet; the intent is
	 * included, and none of the transactions this app sent is the one that did
	 * it. Reading an index off that state is what the `via` union exists to
	 * prevent, and the first attempt is the honest thing to show.
	 */
	it('falls back to the first attempt for an inclusion we did not send', () => {
		const o = operation({
			attempts: [{hash: '0xa'}, {hash: '0xb'}],
			state: {
				inclusion: 'Included',
				outcome: 'Success',
				final: false,
				via: {kind: 'expectedUpdate', blockNumber: 12},
			},
		});
		expect(getMainTxHash(o)).toBe('0xa');
	});
});

describe('isIncludedAttempt', () => {
	it('marks only the attempt the state names', () => {
		const included = state({
			inclusion: 'Included',
			via: {kind: 'attempt', attemptIndex: 1},
		});
		expect(isIncludedAttempt(included, 0)).toBe(false);
		expect(isIncludedAttempt(included, 1)).toBe(true);
	});
	it('marks none of them when no attempt of ours won', () => {
		const outOfBand = state({
			inclusion: 'Included',
			via: {kind: 'expectedUpdate', blockNumber: 9},
		});
		expect(isIncludedAttempt(outOfBand, 0)).toBe(false);
		expect(isIncludedAttempt(undefined, 0)).toBe(false);
	});
});

describe('getTransactionResult', () => {
	it('is the outcome when included, else null', () => {
		expect(
			getTransactionResult(state({inclusion: 'Included', outcome: 'Success'})),
		).toBe('Success');
		expect(getTransactionResult(state({inclusion: 'InMemPool'}))).toBeNull();
	});
});

describe('getEarliestBroadcastMs', () => {
	it('returns the smallest broadcast timestamp', () => {
		const o = operation({
			attempts: [
				{broadcastTimestampMs: 300},
				{broadcastTimestampMs: 100},
				{broadcastTimestampMs: 200},
			],
		});
		expect(getEarliestBroadcastMs(o)).toBe(100);
	});
	it('returns null when there are no attempts', () => {
		expect(getEarliestBroadcastMs(operation({attempts: []}))).toBeNull();
	});
});

/**
 * THE UNIT BUG, PINNED. `state.final` used to hold the inclusion block's unix
 * timestamp and the UI rendered it as "Block {final}". Finality is now a
 * boolean and the timestamp has its own field in the chain's own SECONDS, while
 * `broadcastTimestampMs` remains milliseconds. Nothing converts one into the
 * other implicitly, so the two formatters are tested against the SAME instant
 * expressed in each unit: if either ever grew or lost a factor of 1000, these
 * would stop agreeing.
 */
describe('the two clocks', () => {
	const instantMs = 1_700_000_000_000;
	const instantSeconds = 1_700_000_000;

	it('formats a broadcast (ms) and a block time (seconds) as the same instant', () => {
		expect(formatBroadcastTime(instantMs)).toBe(
			new Date(instantMs).toLocaleString(),
		);
		expect(formatBlockTime(instantSeconds)).toBe(
			new Date(instantMs).toLocaleString(),
		);
		expect(formatBlockTime(instantSeconds)).toBe(
			formatBroadcastTime(instantMs),
		);
	});

	it('says nothing rather than rendering the epoch', () => {
		expect(formatBroadcastTime(undefined)).toBeNull();
		expect(formatBlockTime(undefined)).toBeNull();
		expect(formatBlockTime(0)).toBeNull();
	});

	it('reads blockTimestamp only off an inclusion', () => {
		expect(
			getBlockTimestamp(
				state({inclusion: 'Included', blockTimestamp: instantSeconds}),
			),
		).toBe(instantSeconds);
		expect(getBlockTimestamp(state({inclusion: 'Dropped', final: true}))).toBe(
			undefined,
		);
		expect(getBlockTimestamp(undefined)).toBe(undefined);
	});
});

describe('sortAttemptsNewestFirst', () => {
	it('orders by broadcast time descending without mutating the store-owned array', () => {
		const attempts = [
			{broadcastTimestampMs: 100},
			{broadcastTimestampMs: 300},
			{broadcastTimestampMs: 200},
		];
		expect(
			sortAttemptsNewestFirst(attempts).map((a) => a.broadcastTimestampMs),
		).toEqual([300, 200, 100]);
		expect(attempts.map((a) => a.broadcastTimestampMs)).toEqual([
			100, 300, 200,
		]);
	});
});

describe('getInclusionBadgeVariant', () => {
	it('maps raw inclusion strings', () => {
		expect(getInclusionBadgeVariant('NotFound')).toBe('destructive');
		expect(getInclusionBadgeVariant('Dropped')).toBe('destructive');
		expect(getInclusionBadgeVariant('Included')).toBe('default');
		expect(getInclusionBadgeVariant('InMemPool')).toBe('secondary');
		expect(getInclusionBadgeVariant('Fetching')).toBe('secondary');
	});
});

describe('countPendingOperations', () => {
	it('excludes successfully-included ops but counts the rest', () => {
		const ops = {
			a: operation({state: {inclusion: 'Included', outcome: 'Success'}}),
			b: operation({state: {inclusion: 'Included', outcome: 'Failure'}}),
			c: operation({state: {inclusion: 'InMemPool'}}),
		};
		expect(countPendingOperations(ops)).toBe(2);
	});
});

describe('sortOperationIdsDescending', () => {
	it('sorts numeric ids newest-first without mutating the input', () => {
		const ids = ['100', '2000', '30'];
		const sorted = sortOperationIdsDescending(ids);
		expect(sorted).toEqual(['2000', '100', '30']);
		expect(ids).toEqual(['100', '2000', '30']);
	});
});

describe('partitionOperationsBySender', () => {
	const SIGNER = '0x00000000000000000000000000000000000000aa' as const;
	const ACCOUNT = '0x0000000000000000000000000000000000000001' as const;

	// `from` lives on the CALL: the record hoists it because one route owns the
	// nonce slot for the whole operation.
	const op = (from: string) => ({call: {from}}) as unknown as OnchainOperation;

	it('splits on who sent each operation', () => {
		const entries: [string, OnchainOperation][] = [
			['a', op(SIGNER)],
			['b', op(ACCOUNT)],
			['c', op(SIGNER)],
		];
		const {from, others} = partitionOperationsBySender(entries, SIGNER);
		expect(from.map(([k]) => k)).toEqual(['a', 'c']);
		expect(others.map(([k]) => k)).toEqual(['b']);
	});

	it('compares addresses case-insensitively', () => {
		// `from` comes off the chain and the executor address comes from the
		// wallet; the two disagree on checksum casing often enough that comparing
		// raw strings would quietly put every operation in the wrong bucket.
		const entries: [string, OnchainOperation][] = [
			['a', op('0x00000000000000000000000000000000000000AA')],
		];
		const {from} = partitionOperationsBySender(entries, SIGNER);
		expect(from).toHaveLength(1);
	});

	it('puts everything in others when there is no sender to match', () => {
		// An executor that is not ready has no address. Claiming its operations
		// would be worse than claiming none.
		const entries: [string, OnchainOperation][] = [['a', op(SIGNER)]];
		const {from, others} = partitionOperationsBySender(entries, undefined);
		expect(from).toHaveLength(0);
		expect(others).toHaveLength(1);
	});

	it('keeps the given order within each side', () => {
		const entries: [string, OnchainOperation][] = [
			['a', op(ACCOUNT)],
			['b', op(SIGNER)],
			['c', op(ACCOUNT)],
		];
		const {others} = partitionOperationsBySender(entries, SIGNER);
		expect(others.map(([k]) => k)).toEqual(['a', 'c']);
	});
});
