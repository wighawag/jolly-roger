import {describe, it, expect} from 'vitest';
import {
	reportHeading,
	reportedRequests,
} from '../../../../src/lib/core/transaction/in-flight-report';
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

describe('reportedRequests', () => {
	it('says NOTHING about a request that is still in flight', () => {
		// The connection flow already has "Please confirm the request in your
		// wallet" on screen. A second dialog on top of it, about the same request,
		// would be the app contradicting itself while the user is mid-answer.
		const state: InFlightState = {
			requests: [request('a', 'setMessage')],
			outcomes: {},
			dispatching: 0,
		};
		expect(reportedRequests(state)).toEqual([]);
	});

	it('says nothing about a request the app turned out to have recorded', () => {
		const state: InFlightState = {
			requests: [request('a', 'setMessage')],
			outcomes: {a: {status: 'recorded', nonce: 3}},
			dispatching: 0,
		};
		expect(reportedRequests(state)).toEqual([]);
	});

	it('reports a reconciled request with the sentence for its outcome', () => {
		const state: InFlightState = {
			requests: [request('a', 'setMessage')],
			outcomes: {a: {status: 'unknown', reason: 'nonce-free'}},
			dispatching: 0,
		};
		const [reported] = reportedRequests(state);
		expect(reported.id).toBe('a');
		expect(reported.description).toBe('setMessage');
		expect(reported.account).toBe(ACCOUNT);
		expect(reported.message).toContain('still be waiting in your wallet');
	});

	it('keeps the order the user did things in', () => {
		const state: InFlightState = {
			requests: [request('a', 'first'), request('b', 'second')],
			outcomes: {
				a: {status: 'unknown', reason: 'nonce-free'},
				b: {status: 'nonce-consumed', nonce: 4},
			},
			dispatching: 0,
		};
		expect(reportedRequests(state).map((r) => r.description)).toEqual([
			'first',
			'second',
		]);
	});

	it('reports only the reconciled ones when both kinds are present', () => {
		const state: InFlightState = {
			requests: [request('a', 'done being asked'), request('b', 'asking now')],
			outcomes: {a: {status: 'unknown', reason: 'nonce-free'}},
			dispatching: 0,
		};
		expect(reportedRequests(state).map((r) => r.id)).toEqual(['a']);
	});
});

describe('reportHeading: the modal must not contradict its own body', () => {
	const reported = (outcome: any) => ({
		id: 'a',
		description: 'setMessage',
		account: ACCOUNT,
		requestedAt: 1,
		outcome,
		message: 'x',
	});

	it('does not hedge about a transaction it watched go out', () => {
		// The body says "This transaction WAS sent (0x...)". A header reading
		// "never answered, so it cannot say whether it went through" makes the app
		// contradict itself in the same dialog.
		const heading = reportHeading([
			reported({status: 'broadcast-not-recorded', hash: '0xabc'}),
		]);
		expect(heading.title).not.toContain('may have been sent');
		expect(heading.lead).not.toContain('never answered');
		expect(heading.lead).toContain('on chain');
		expect(heading.lead).toContain('not the transaction');
	});

	it('hedges when it genuinely does not know', () => {
		const heading = reportHeading([
			reported({status: 'unknown', reason: 'nonce-free'}),
		]);
		expect(heading.title).toContain('may have been sent');
		expect(heading.lead).toContain('never answered');
	});

	it('never says "this transaction", because there is nothing to point at', () => {
		// Reported: after a reload the modal says "This transaction may have been
		// sent" about a request from a session that is over, so "this" points at
		// nothing on screen and reads as though the app has lost track of what it
		// is talking about.
		const headings = [
			reportHeading([reported({status: 'unknown', reason: 'nonce-free'})]),
			reportHeading([
				reported({status: 'broadcast-not-recorded', hash: '0xa'}),
			]),
			reportHeading([
				reported({status: 'unknown', reason: 'nonce-free'}),
				reported({status: 'unknown', reason: 'unreadable'}),
			]),
		];
		for (const heading of headings) {
			expect(heading.title.toLowerCase()).not.toContain('this transaction');
			expect(heading.lead.toLowerCase()).not.toContain('send this');
		}
	});

	it('hedges for a mixed set, because the hedge is true of one of them', () => {
		const heading = reportHeading([
			reported({status: 'broadcast-not-recorded', hash: '0xabc'}),
			reported({status: 'unknown', reason: 'nonce-free'}),
		]);
		expect(heading.title).toContain('may have been sent');
	});

	it('counts, so it never says "this transaction" about three', () => {
		expect(
			reportHeading([
				reported({status: 'unknown', reason: 'nonce-free'}),
				reported({status: 'unknown', reason: 'nonce-free'}),
			]).title,
		).toContain('Some transactions');
		expect(
			reportHeading([
				reported({status: 'broadcast-not-recorded', hash: '0xa'}),
				reported({status: 'broadcast-not-recorded', hash: '0xb'}),
			]).title,
		).toBe('Transactions missing from your list');
	});
});
