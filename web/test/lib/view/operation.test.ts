import {describe, it, expect} from 'vitest';
import {
	getOperationName,
	getOperationStatusInfo,
	getMainTxHash,
	getTransactionResult,
	getEarliestBroadcastMs,
	getInclusionBadgeVariant,
	partitionOperationsBySender,
	countPendingOperations,
	sortOperationIdsDescending,
} from '../../../src/lib/view/operation';
import type {OnchainOperation} from '../../../src/lib/account/AccountData';
import type {TransactionIntent} from '@etherkit/tx-observer';

const op = (metadata: unknown): OnchainOperation =>
	({metadata}) as unknown as OnchainOperation;

const intent = (partial: unknown): TransactionIntent =>
	partial as unknown as TransactionIntent;

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
	it('maps each inclusion/status to kind + label + variant', () => {
		expect(getOperationStatusInfo(intent({}))).toMatchObject({kind: 'pending'});
		expect(
			getOperationStatusInfo(intent({state: {inclusion: 'InMemPool'}})),
		).toMatchObject({kind: 'pending', variant: 'secondary'});
		expect(
			getOperationStatusInfo(intent({state: {inclusion: 'NotFound'}})),
		).toMatchObject({kind: 'notFound', variant: 'destructive'});
		expect(
			getOperationStatusInfo(intent({state: {inclusion: 'Dropped'}})),
		).toMatchObject({kind: 'dropped'});
		expect(
			getOperationStatusInfo(
				intent({state: {inclusion: 'Included', status: 'Success'}}),
			),
		).toMatchObject({kind: 'success', label: 'Success', variant: 'default'});
		expect(
			getOperationStatusInfo(
				intent({state: {inclusion: 'Included', status: 'Failure'}}),
			),
		).toMatchObject({kind: 'failed', variant: 'destructive'});
	});
});

describe('getMainTxHash', () => {
	it('returns undefined with no attempts', () => {
		expect(getMainTxHash(intent({transactions: []}))).toBeUndefined();
	});
	it('prefers the included attempt index', () => {
		const i = intent({
			transactions: [{hash: '0xa'}, {hash: '0xb'}],
			state: {inclusion: 'Included', attemptIndex: 1},
		});
		expect(getMainTxHash(i)).toBe('0xb');
	});
	it('falls back to the first attempt', () => {
		const i = intent({transactions: [{hash: '0xa'}, {hash: '0xb'}]});
		expect(getMainTxHash(i)).toBe('0xa');
	});
});

describe('getTransactionResult', () => {
	it('is the status when included, else null', () => {
		expect(
			getTransactionResult(
				intent({state: {inclusion: 'Included', status: 'Success'}}),
			),
		).toBe('Success');
		expect(
			getTransactionResult(intent({state: {inclusion: 'InMemPool'}})),
		).toBeNull();
	});
});

describe('getEarliestBroadcastMs', () => {
	it('returns the smallest broadcast timestamp', () => {
		const i = intent({
			transactions: [
				{broadcastTimestampMs: 300},
				{broadcastTimestampMs: 100},
				{broadcastTimestampMs: 200},
			],
		});
		expect(getEarliestBroadcastMs(i)).toBe(100);
	});
	it('returns null when there are no attempts', () => {
		expect(getEarliestBroadcastMs(intent({transactions: []}))).toBeNull();
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
			a: op({}) as any,
			b: op({}) as any,
			c: op({}) as any,
		};
		ops.a.transactionIntent = {
			state: {inclusion: 'Included', status: 'Success'},
		};
		ops.b.transactionIntent = {
			state: {inclusion: 'Included', status: 'Failure'},
		};
		ops.c.transactionIntent = {state: {inclusion: 'InMemPool'}};
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

	const op = (from: string) =>
		({metadata: {tx: {from}}}) as unknown as OnchainOperation;

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
