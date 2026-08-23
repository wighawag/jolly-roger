import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {createSendingState} from '../../../../src/lib/ui/in-flight/sending';
import type {InFlightState} from '../../../../src/lib/core/transaction/in-flight-store';

/**
 * The banner exists to explain the browser's unload prompt, so what it must get
 * right is agreeing with the thing that arms it.
 *
 * `startInFlightTracking` guards unload on `hasUnansweredRequest`, which is
 * `dispatching > 0`. If this lit up for anything else the page would carry a
 * banner with no dialog behind it; if it stayed dark for a real dispatch the
 * dialog would arrive unexplained, which is the bug it is for.
 */
function state(over: Partial<InFlightState> = {}): InFlightState {
	return {
		requests: [],
		outcomes: {},
		dispatching: 0,
		...over,
	} as InFlightState;
}

function request(id: string, description?: string) {
	return {
		id,
		account: '0x1111111111111111111111111111111111111111',
		chainId: 31337,
		nonce: 1,
		intent: {description},
		requestedAt: 0,
	} as unknown as InFlightState['requests'][number];
}

describe('the sending banner state', () => {
	it('is dark when nothing is being awaited', () => {
		const s = createSendingState(writable(state()));
		expect(get(s).sending).toBe(false);
	});

	it('lights up on the same condition the unload guard uses', () => {
		// `dispatching` is the discriminator, not `requests.length`.
		const s = createSendingState(
			writable(state({dispatching: 1, requests: [request('a', 'a move')]})),
		);
		expect(get(s)).toMatchObject({sending: true, count: 1, description: 'a move'});
	});

	it('stays dark for records that are unreconciled but no longer awaited', () => {
		// The ledger keeps a record after the app stops waiting on it. The unload
		// guard does not fire for those, so neither may this: a banner with no
		// dialog behind it is the mirror image of the bug it exists to fix.
		const s = createSendingState(
			writable(state({dispatching: 0, requests: [request('a', 'a move')]})),
		);
		expect(get(s).sending).toBe(false);
	});

	it('names the oldest awaited request, not a settled one', () => {
		const s = createSendingState(
			writable(
				state({
					dispatching: 1,
					requests: [request('old', 'the settled one'), request('new', 'a move')],
					outcomes: {old: {kind: 'nonce-consumed'} as never},
				}),
			),
		);
		expect(get(s).description).toBe('a move');
	});

	it('counts rather than claiming one', () => {
		const s = createSendingState(
			writable(
				state({
					dispatching: 2,
					requests: [request('a', 'first'), request('b', 'second')],
				}),
			),
		);
		expect(get(s).count).toBe(2);
	});

	it('survives a dispatch that carried no description', () => {
		const s = createSendingState(
			writable(state({dispatching: 1, requests: [request('a')]})),
		);
		expect(get(s)).toMatchObject({sending: true, description: undefined});
	});
});
