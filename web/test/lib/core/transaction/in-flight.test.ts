import {describe, it, expect} from 'vitest';
import {
	describeOutcome,
	isInFlightRequest,
	isWorthReporting,
	reconcileRequest,
	type InFlightRequest,
} from '../../../../src/lib/core/transaction/in-flight';

const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;

function request(overrides: Partial<InFlightRequest> = {}): InFlightRequest {
	return {
		id: 'req-1',
		account: ACCOUNT,
		chainId: 31337,
		nonce: 7,
		intent: {description: 'setMessage'},
		requestedAt: 1000,
		...overrides,
	};
}

describe('reconcileRequest', () => {
	it('reports a request the app already recorded, so nothing is said about it', () => {
		const outcome = reconcileRequest({
			request: request({nonce: 7}),
			nodeNonce: 8,
			recordedNonces: [7],
		});
		expect(outcome).toEqual({status: 'recorded', nonce: 7});
		expect(isWorthReporting(outcome)).toBe(false);
	});

	it('reports the nonce as consumed when the node has moved past the baseline', () => {
		const outcome = reconcileRequest({
			request: request({nonce: 7}),
			nodeNonce: 8,
			recordedNonces: [],
		});
		expect(outcome).toEqual({status: 'nonce-consumed', nonce: 7});
		expect(isWorthReporting(outcome)).toBe(true);
	});

	it('stays unknown when nothing has landed, and never says rejected or failed', () => {
		const outcome = reconcileRequest({
			request: request({nonce: 7}),
			nodeNonce: 7,
			recordedNonces: [],
		});
		expect(outcome).toEqual({status: 'unknown', reason: 'nonce-free'});
	});

	it('stays unknown when the node reports fewer transactions than the baseline', () => {
		// A restarted dev node, which nonce-cache.ts documents at length. The
		// comparison is against a different history, so it proves nothing.
		expect(
			reconcileRequest({
				request: request({nonce: 7}),
				nodeNonce: 3,
				recordedNonces: [],
			}),
		).toEqual({status: 'unknown', reason: 'nonce-behind'});
	});

	it('stays unknown with no baseline, whatever the node says', () => {
		expect(
			reconcileRequest({
				request: request({nonce: undefined}),
				nodeNonce: 99,
				recordedNonces: [],
			}),
		).toEqual({status: 'unknown', reason: 'no-baseline'});
	});

	it('stays unknown when the node cannot be read', () => {
		expect(
			reconcileRequest({
				request: request({nonce: 7}),
				nodeNonce: undefined,
				recordedNonces: [],
			}),
		).toEqual({status: 'unknown', reason: 'unreadable'});
	});

	it('treats unknown recorded nonces as a third answer, not as none', () => {
		// Account data is per account and restored asynchronously, so "we have no
		// data for this account" must not be read as "the app never saw it": that
		// would report on a transaction sitting in the user's own list.
		const notKnown = reconcileRequest({
			request: request({nonce: 7}),
			nodeNonce: 8,
			recordedNonces: undefined,
		});
		expect(notKnown).toEqual({status: 'nonce-consumed', nonce: 7});

		const known = reconcileRequest({
			request: request({nonce: 7}),
			nodeNonce: 8,
			recordedNonces: [7],
		});
		expect(known.status).toBe('recorded');
	});

	it('checks what the app recorded before it can be told the node is unreadable', () => {
		// Offline, but the app already has the transaction: there is still nothing
		// to warn about, and "we cannot reach the chain" would be a worse answer
		// than the one we already hold.
		expect(
			reconcileRequest({
				request: request({nonce: 7}),
				nodeNonce: undefined,
				recordedNonces: [7],
			}),
		).toEqual({status: 'recorded', nonce: 7});
	});
});

describe('describeOutcome', () => {
	it('never claims a transaction failed or was rejected', () => {
		const outcomes = [
			{status: 'recorded', nonce: 1},
			{status: 'nonce-consumed', nonce: 1},
			{status: 'unknown', reason: 'nonce-free'},
			{status: 'unknown', reason: 'nonce-behind'},
			{status: 'unknown', reason: 'no-baseline'},
			{status: 'unknown', reason: 'unreadable'},
		] as const;

		for (const outcome of outcomes) {
			const text = describeOutcome(outcome).toLowerCase();
			expect(text).not.toContain('failed');
			expect(text).not.toContain('was rejected');
			expect(text).not.toContain('did not happen');
			expect(text.length).toBeGreaterThan(0);
		}
	});

	it('says the request may still be with the wallet when nothing has landed', () => {
		const text = describeOutcome({status: 'unknown', reason: 'nonce-free'});
		expect(text).toContain('still be waiting in your wallet');
		expect(text).toContain('Approving it later');
	});
});

describe('isInFlightRequest', () => {
	it('accepts a well-formed record, with or without a nonce', () => {
		expect(isInFlightRequest(request())).toBe(true);
		expect(isInFlightRequest(request({nonce: undefined}))).toBe(true);
	});

	it('rejects anything it could not tell the user something true about', () => {
		expect(isInFlightRequest(undefined)).toBe(false);
		expect(isInFlightRequest('nope')).toBe(false);
		expect(isInFlightRequest({})).toBe(false);
		expect(isInFlightRequest({...request(), id: 1})).toBe(false);
		expect(isInFlightRequest({...request(), chainId: '31337'})).toBe(false);
		expect(isInFlightRequest({...request(), nonce: '7'})).toBe(false);
		expect(isInFlightRequest({...request(), intent: {}})).toBe(false);
		expect(isInFlightRequest({...request(), intent: undefined})).toBe(false);
	});
});
