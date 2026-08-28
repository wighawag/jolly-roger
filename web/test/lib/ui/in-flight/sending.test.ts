import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {get, writable, type Readable} from 'svelte/store';
import {
	createSendingState,
	createSendingNotice,
	createSendingPulse,
	delayVisible,
	holdVisible,
	sendingIndicatorSlot,
	MIN_VISIBLE_MS,
	NOTICE_AFTER_MS,
	type SendingIndicatorPlacement,
	type SendingState,
} from '../../../../src/lib/ui/in-flight/sending';
import type {InFlightState} from '../../../../src/lib/core/transaction/in-flight-store';

/**
 * The indicator exists to explain the browser's unload prompt, so what it must
 * get right is agreeing with the thing that arms it.
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
		// Zero by DEFAULT, so every case below is a dispatch no human was asked
		// about: the local signer, which is the case this indicator was written for.
		// If any of them started depending on `prompting`, they would go dark here
		// and the silent send would be back to an unexplained unload dialog.
		prompting: 0,
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

describe('the sending state', () => {
	it('is dark when nothing is being awaited', () => {
		const s = createSendingState(writable(state()));
		expect(get(s).sending).toBe(false);
	});

	it('lights up on the same condition the unload guard uses', () => {
		// `dispatching` is the discriminator, not `requests.length`.
		const s = createSendingState(
			writable(state({dispatching: 1, requests: [request('a', 'a move')]})),
		);
		expect(get(s)).toMatchObject({
			sending: true,
			count: 1,
			description: 'a move',
		});
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
					requests: [
						request('old', 'the settled one'),
						request('new', 'a move'),
					],
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

	it('lights up for a send NOBODY was prompted about, which is the point', () => {
		// "Wallet Action Required" is suppressed for these (see wallet-activity),
		// because no wallet asked anyone anything. This surface is the opposite
		// case and must stay broad: the unload guard still fires, and this is the
		// only thing on screen explaining it. Narrowing it to `prompting` would
		// recreate the unexplained blocking dialog it was written to close.
		const s = createSendingState(
			writable(
				state({
					dispatching: 1,
					prompting: 0,
					requests: [request('a', 'commit')],
				}),
			),
		);
		expect(get(s)).toMatchObject({
			sending: true,
			count: 1,
			description: 'commit',
		});
	});
});

/**
 * The hold is what makes a sub-second local-signer dispatch readable instead of
 * a flicker, and its asymmetry is load-bearing.
 *
 * A `beforeunload` dialog blocks the renderer: no timers, no paint. So the
 * indicator may never be scheduled to appear LATER than the dispatch it
 * explains, or an early reload gets the dialog with nothing behind it. Delaying
 * the disappearance is free, because by then there is nothing left to explain.
 */
describe('holding the indicator visible', () => {
	// The exported default, not a copy of it: these tests pass it back in as an
	// option, so a changed constant that nothing else pinned would leave them
	// green while the app behaved differently.
	const MIN = MIN_VISIBLE_MS;

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	/** Subscribed, because the hold only runs while something is watching. */
	function watch(source: Readable<SendingState>) {
		const seen: boolean[] = [];
		const held = holdVisible(source, {minVisibleMs: MIN});
		const stop = held.subscribe(($held) => seen.push($held.sending));
		return {held, seen, stop};
	}
	function read(): SendingState {
		return {sending: false, count: 0, description: undefined};
	}

	it('appears in the same tick the dispatch starts', () => {
		// The one property that cannot be traded away: the page is frozen once the
		// dialog is up, so "later" means "never".
		const source = writable(read());
		const {held, stop} = watch(source);
		source.set({sending: true, count: 1, description: 'a move'});
		expect(get(held)).toMatchObject({sending: true, description: 'a move'});
		stop();
	});

	it('stays up for the minimum after a dispatch that resolved instantly', () => {
		const source = writable(read());
		const {held, stop} = watch(source);
		source.set({sending: true, count: 1, description: 'a move'});
		vi.advanceTimersByTime(50);
		source.set(read());

		expect(get(held).sending).toBe(true);
		vi.advanceTimersByTime(MIN - 50 - 1);
		expect(get(held).sending).toBe(true);
		vi.advanceTimersByTime(1);
		expect(get(held).sending).toBe(false);
		stop();
	});

	it('keeps the words it was showing while it fades', () => {
		// Blanking the text first would fade out an empty box. What was being sent
		// does not stop being true the moment the answer arrives.
		const source = writable(read());
		const {held, stop} = watch(source);
		source.set({sending: true, count: 1, description: 'a move'});
		source.set(read());
		expect(get(held).description).toBe('a move');
		stop();
	});

	it('does not hold a dispatch that was never shown', () => {
		// Nothing appeared, so there is nothing to keep on screen, and the page must
		// not wait before agreeing that nothing is happening.
		const source = writable(read());
		const {held, stop} = watch(source);
		source.set(read());
		expect(get(held).sending).toBe(false);
		stop();
	});

	it('lets a long dispatch disappear as soon as it is answered', () => {
		const source = writable(read());
		const {held, stop} = watch(source);
		source.set({sending: true, count: 1, description: 'a move'});
		vi.advanceTimersByTime(MIN * 3);
		source.set(read());
		expect(get(held).sending).toBe(false);
		stop();
	});

	it('reads two quick sends as one appearance, not a strobe', () => {
		const source = writable(read());
		const {held, seen, stop} = watch(source);
		source.set({sending: true, count: 1, description: 'first'});
		vi.advanceTimersByTime(20);
		source.set(read());
		vi.advanceTimersByTime(20);
		source.set({sending: true, count: 1, description: 'second'});
		vi.advanceTimersByTime(20);
		source.set(read());

		expect(get(held).sending).toBe(true);
		// It never went dark in between, so it never blinked.
		expect(seen.filter((visible) => !visible)).toHaveLength(1); // the initial one
		// And the clock restarted on the second, rather than expiring on the first.
		vi.advanceTimersByTime(MIN - 20 - 1);
		expect(get(held).sending).toBe(true);
		vi.advanceTimersByTime(1);
		expect(get(held).sending).toBe(false);
		stop();
	});

	it('stops its timer when nothing is watching', () => {
		const source = writable(read());
		const {stop} = watch(source);
		source.set({sending: true, count: 1, description: 'a move'});
		source.set(read());
		stop();
		expect(vi.getTimerCount()).toBe(0);
	});
});

/**
 * The delay is what keeps WORDS off the screen for a routine send, and it is
 * only defensible because it is the second rung: the navbar pulse is immediate,
 * so something is always up while the guard is armed.
 */
describe('delaying the explanatory notice', () => {
	const AFTER = NOTICE_AFTER_MS;

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function sending(
		count = 1,
		description: string | undefined = 'a move',
	): SendingState {
		return {sending: true, count, description};
	}
	function dark(): SendingState {
		return {sending: false, count: 0, description: undefined};
	}
	function watch(source: Readable<SendingState>) {
		const delayed = delayVisible(source, {afterMs: AFTER});
		const seen: boolean[] = [];
		const stop = delayed.subscribe(($delayed) => seen.push($delayed.sending));
		return {delayed, seen, stop};
	}

	it('says nothing about a dispatch that is answered quickly', () => {
		// The whole point: a local-signer send paints no text, ever.
		const source = writable(dark());
		const {delayed, seen, stop} = watch(source);
		source.set(sending());
		vi.advanceTimersByTime(300);
		source.set(dark());
		vi.advanceTimersByTime(AFTER * 2);

		expect(get(delayed).sending).toBe(false);
		expect(seen).toEqual([false]);
		stop();
	});

	it('speaks up once a dispatch outlasts the delay', () => {
		const source = writable(dark());
		const {delayed, stop} = watch(source);
		source.set(sending());
		vi.advanceTimersByTime(AFTER - 1);
		expect(get(delayed).sending).toBe(false);
		vi.advanceTimersByTime(1);
		expect(get(delayed)).toMatchObject({sending: true, description: 'a move'});
		stop();
	});

	it('opens with what is true THEN, not with what started the clock', () => {
		// A second dispatch joining mid-countdown must not be announced as one.
		const source = writable(dark());
		const {delayed, stop} = watch(source);
		source.set(sending(1, 'first'));
		vi.advanceTimersByTime(AFTER / 2);
		source.set(sending(2, 'first'));
		vi.advanceTimersByTime(AFTER / 2);
		expect(get(delayed).count).toBe(2);
		stop();
	});

	it('does not restart its clock on every update within one run', () => {
		// A busy dispatch would otherwise never reach its own deadline.
		const source = writable(dark());
		const {delayed, stop} = watch(source);
		source.set(sending(1, 'a move'));
		for (let elapsed = 0; elapsed < AFTER; elapsed += 100) {
			vi.advanceTimersByTime(100);
			source.set(sending(1, 'a move'));
		}
		expect(get(delayed).sending).toBe(true);
		stop();
	});

	it('starts from zero for the next run rather than accumulating', () => {
		// Two quick sends with a gap are two short dispatches, not one long one.
		const source = writable(dark());
		const {delayed, stop} = watch(source);
		source.set(sending());
		vi.advanceTimersByTime(AFTER - 100);
		source.set(dark());
		vi.advanceTimersByTime(50);
		source.set(sending());
		vi.advanceTimersByTime(200);
		expect(get(delayed).sending).toBe(false);
		stop();
	});

	it('closes as soon as the dispatch is answered', () => {
		const source = writable(dark());
		const {delayed, stop} = watch(source);
		source.set(sending());
		vi.advanceTimersByTime(AFTER);
		expect(get(delayed).sending).toBe(true);
		source.set(dark());
		expect(get(delayed).sending).toBe(false);
		stop();
	});

	it('leaves no timer behind when nothing is watching', () => {
		const source = writable(dark());
		const {stop} = watch(source);
		source.set(sending());
		stop();
		expect(vi.getTimerCount()).toBe(0);
	});
});

/**
 * The two rungs as the components actually build them. What matters here is the
 * RELATIONSHIP: the wordless one is up whenever the guard is armed, and the
 * explanatory one is a strict subset of it.
 */
describe('the two sending surfaces', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('pulses immediately and stays wordless for a quick dispatch', () => {
		const ledger = writable(state());
		const pulse = createSendingPulse(ledger);
		const notice = createSendingNotice(ledger);
		const stopPulse = pulse.subscribe(() => {});
		const stopNotice = notice.subscribe(() => {});

		ledger.set(state({dispatching: 1, requests: [request('a', 'a move')]}));
		// Same tick: this is the one that has to be on screen when the browser asks,
		// because the dialog freezes the page and nothing scheduled will paint.
		expect(get(pulse).sending).toBe(true);
		expect(get(notice).sending).toBe(false);

		vi.advanceTimersByTime(300);
		ledger.set(state());
		vi.advanceTimersByTime(5_000);
		expect(get(pulse).sending).toBe(false);
		// It never said a word about a send that took 300ms.
		expect(get(notice).sending).toBe(false);

		stopPulse();
		stopNotice();
	});

	it('uses the exported defaults, which is what the tests above pin', () => {
		// `createSendingPulse` and `createSendingNotice` take no options here, so
		// this is the one place that checks the timings the app actually runs with
		// are the ones the rules were tested at.
		const ledger = writable(state());
		const pulse = createSendingPulse(ledger);
		const notice = createSendingNotice(ledger);
		const stopPulse = pulse.subscribe(() => {});
		const stopNotice = notice.subscribe(() => {});

		ledger.set(state({dispatching: 1, requests: [request('a', 'a move')]}));
		vi.advanceTimersByTime(NOTICE_AFTER_MS - 1);
		expect(get(notice).sending).toBe(false);
		vi.advanceTimersByTime(1);
		expect(get(notice).sending).toBe(true);

		ledger.set(state());
		// The hold is measured from when each rung APPEARED, not from when the
		// dispatch was answered, and the two appeared at different times. The pulse
		// has been up since the start and has long served its minimum, so it drops
		// at once. The notice went up a millisecond ago, and dropping it now is
		// exactly the flash the hold exists to prevent, so it stays.
		expect(get(pulse).sending).toBe(false);
		expect(get(notice).sending).toBe(true);
		vi.advanceTimersByTime(MIN_VISIBLE_MS - 1);
		expect(get(notice).sending).toBe(true);
		vi.advanceTimersByTime(1);
		expect(get(notice).sending).toBe(false);

		stopPulse();
		stopNotice();
	});

	it('holds a short dispatch for the exported minimum', () => {
		const ledger = writable(state());
		const pulse = createSendingPulse(ledger);
		const stopPulse = pulse.subscribe(() => {});

		ledger.set(state({dispatching: 1, requests: [request('a', 'a move')]}));
		vi.advanceTimersByTime(100);
		ledger.set(state());

		vi.advanceTimersByTime(MIN_VISIBLE_MS - 100 - 1);
		expect(get(pulse).sending).toBe(true);
		vi.advanceTimersByTime(1);
		expect(get(pulse).sending).toBe(false);

		stopPulse();
	});

	it('explains a dispatch that drags, with both rungs up', () => {
		const ledger = writable(state());
		const pulse = createSendingPulse(ledger);
		const notice = createSendingNotice(ledger);
		const stopPulse = pulse.subscribe(() => {});
		const stopNotice = notice.subscribe(() => {});

		ledger.set(state({dispatching: 1, requests: [request('a', 'a move')]}));
		vi.advanceTimersByTime(2_000);
		expect(get(pulse).sending).toBe(true);
		expect(get(notice)).toMatchObject({sending: true, description: 'a move'});

		stopPulse();
		stopNotice();
	});
});

/**
 * The knob exists for descendants to flip, so the failure that matters is a
 * placement that compiles and renders nowhere.
 */
describe('where a placement is mounted', () => {
	it('gives every placement an answer', () => {
		// Listed here rather than derived from the type, because the type is erased:
		// this is what fails if a member is added to the union and forgotten. The
		// `never` branch in `sendingIndicatorSlot` covers the other direction.
		const placements: SendingIndicatorPlacement[] = [
			'floating',
			'banner',
			'none',
		];
		expect(placements.map(sendingIndicatorSlot)).toEqual([
			'overlay',
			'flow',
			undefined,
		]);
	});
});
