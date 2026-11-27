// QA F23: a push's hand-off in its navigate URL (`#push-handoff=...`), read by
// the page where the worker never runs (Safari's Declarative Web Push), and
// published with the worker's clicks as one stream.
import {describe, expect, it, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	consumePushHandoff,
	createPushHandoffs,
	splitPushHandoff,
	splitUrlPushHandoff,
	withPushHandoff,
	type HandoffWindow,
	type PushHandoffRead,
} from '../../../../src/lib/core/service-worker/push-handoff';
import {
	SAME_CLICK_WINDOW_MS,
	createNotificationClicks,
} from '../../../../src/lib/core/service-worker/notification-click';

// missiv's README, "Push notifications": the test vector of the format
const VECTOR = {
	input: 'https://app.example/#/conversations?x=1',
	handoff: {
		missiv: {
			type: 'message',
			namespace: '',
			conversationID: '0xconv',
			recipient: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		},
	},
	output:
		'https://app.example/#/conversations?x=1&push-handoff=eyJtaXNzaXYiOnsidHlwZSI6Im1lc3NhZ2UiLCJuYW1lc3BhY2UiOiIiLCJjb252ZXJzYXRpb25JRCI6IjB4Y29udiIsInJlY2lwaWVudCI6IjB4YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiJ9fQ',
};

const hashOf = (url: string) => url.slice(url.indexOf('#'));

describe('the format', () => {
	it("matches missiv's test vector, both ways", () => {
		expect(withPushHandoff(VECTOR.input, VECTOR.handoff)).toBe(VECTOR.output);
		expect(splitPushHandoff(hashOf(VECTOR.output))).toEqual({
			handoff: VECTOR.handoff,
			hash: '#/conversations?x=1',
		});
	});

	it('is the whole fragment of a URL without one (or ending in #)', () => {
		const url = withPushHandoff('https://app.example/', {a: 1});
		expect(url).toMatch(/^https:\/\/app\.example\/#push-handoff=[\w-]+$/);
		expect(withPushHandoff('https://app.example/#', {a: 1})).toBe(url);
		expect(splitPushHandoff(hashOf(url))).toEqual({handoff: {a: 1}, hash: ''});
	});

	it('round-trips non-ASCII text', () => {
		const handoff = {s: {name: 'été 🌞'}};
		const url = withPushHandoff('https://app.example/', handoff);
		expect(splitPushHandoff(hashOf(url)).handoff).toEqual(handoff);
	});

	it('leaves a hash without a hand-off as it was', () => {
		for (const hash of ['', '#', '#/x', '#a=1&b=2', 'no-hash']) {
			expect(splitPushHandoff(hash)).toEqual({handoff: undefined, hash});
		}
		// only the LAST segment is the hand-off
		const first = hashOf(withPushHandoff('https://a/', {a: 1})) + '&b=2';
		expect(splitPushHandoff(first)).toEqual({handoff: undefined, hash: first});
	});

	it('removes a malformed or non-object hand-off, giving undefined', () => {
		expect(splitPushHandoff('#x=1&push-handoff=%%%')).toEqual({
			handoff: undefined,
			hash: '#x=1',
		});
		const array = withPushHandoff('https://a/', [1, 2]);
		expect(splitPushHandoff(hashOf(array))).toEqual({
			handoff: undefined,
			hash: '',
		});
	});

	it('strips the hand-off from a URL, keeping the rest of it', () => {
		expect(splitUrlPushHandoff(VECTOR.output)).toEqual({
			handoff: VECTOR.handoff,
			url: VECTOR.input,
		});
		const root = withPushHandoff('https://app.example/', {a: 1});
		expect(splitUrlPushHandoff(root)).toEqual({
			handoff: {a: 1},
			url: 'https://app.example/',
		});
		for (const url of ['/demo?x=1', '/demo#a=1']) {
			expect(splitUrlPushHandoff(url)).toEqual({handoff: undefined, url});
		}
	});
});

function fakeWindow(href: string) {
	const url = new URL(href);
	const replaced: {state: unknown; url: string}[] = [];
	const listeners: {type: string; listener: () => void; capture: boolean}[] =
		[];
	const location = {
		get href() {
			return url.href;
		},
		get pathname() {
			return url.pathname;
		},
		get search() {
			return url.search;
		},
		get hash() {
			return url.hash;
		},
	};
	const history = {
		state: {kept: true} as unknown,
		replaceState(state: unknown, _unused: string, to: string) {
			replaced.push({state, url: to});
			const next = new URL(to, url.href);
			url.pathname = next.pathname;
			url.search = next.search;
			url.hash = next.hash;
		},
	};
	const target: HandoffWindow = {
		location,
		history,
		addEventListener(type, listener, options) {
			listeners.push({type, listener, capture: options.capture});
		},
		removeEventListener(type, listener) {
			const i = listeners.findIndex(
				(l) => l.type === type && l.listener === listener,
			);
			if (i !== -1) listeners.splice(i, 1);
		},
	};
	return {
		target,
		replaced,
		listeners,
		/** a fragment navigation, as a click on a notification of a tab already open does */
		navigateHash(hash: string) {
			url.hash = hash;
			for (const l of listeners.filter((l) => l.type === 'hashchange')) {
				l.listener();
			}
		},
	};
}

describe('consumePushHandoff', () => {
	it('removes the hand-off with replaceState, keeping path, query, state and the rest of the fragment', () => {
		const w = fakeWindow(
			withPushHandoff('https://app.example/demo/?q=1#/x?y=2', {a: 1}),
		);
		expect(consumePushHandoff(w.target.location, w.target.history)).toEqual({
			a: 1,
		});
		expect(w.replaced).toEqual([
			{state: {kept: true}, url: '/demo/?q=1#/x?y=2'},
		]);
		expect(w.target.location.href).toBe('https://app.example/demo/?q=1#/x?y=2');
		// once: nothing left to read
		expect(
			consumePushHandoff(w.target.location, w.target.history),
		).toBeUndefined();
		expect(w.replaced).toHaveLength(1);
	});

	it('does nothing without a hand-off', () => {
		const w = fakeWindow('https://app.example/demo/#a=1');
		expect(
			consumePushHandoff(w.target.location, w.target.history),
		).toBeUndefined();
		expect(w.replaced).toEqual([]);
	});

	it('removes a malformed one too', () => {
		const w = fakeWindow('https://app.example/#push-handoff=!!');
		expect(
			consumePushHandoff(w.target.location, w.target.history),
		).toBeUndefined();
		expect(w.replaced).toEqual([{state: {kept: true}, url: '/'}]);
	});
});

describe('createPushHandoffs', () => {
	it('reads the URL on install, and again on every hashchange, in the capture phase', () => {
		const w = fakeWindow(withPushHandoff('https://app.example/', {n: 1}));
		const handoffs = createPushHandoffs();
		const stop = handoffs.install(w.target);

		expect(get(handoffs.reads)).toEqual({
			id: 1,
			url: 'https://app.example/',
			handoff: {n: 1},
		});
		expect(w.listeners.map((l) => [l.type, l.capture])).toEqual([
			['popstate', true],
			['hashchange', true],
		]);

		w.navigateHash(hashOf(withPushHandoff('https://app.example/', {n: 2})));
		expect(get(handoffs.reads)).toMatchObject({id: 2, handoff: {n: 2}});
		expect(w.target.location.hash).toBe('');

		// a hash change of the app's own is not a click
		w.navigateHash('#/x');
		expect(get(handoffs.reads)?.id).toBe(2);

		stop();
		expect(w.listeners).toEqual([]);
	});

	it('publishes nothing for a URL without one', () => {
		const handoffs = createPushHandoffs();
		handoffs.install(fakeWindow('https://app.example/demo/').target);
		expect(get(handoffs.reads)).toBeUndefined();
	});
});

describe('the clicks, with the hand-offs', () => {
	const ROOT = 'https://app.example/';
	const handoff = {missiv: {type: 'message', conversationID: '0xc'}};

	function setup(href = ROOT) {
		const reads = writable<PushHandoffRead | undefined>(undefined);
		const navigateTo = vi.fn();
		let time = 0;
		const clicks = createNotificationClicks({
			navigateTo,
			currentHref: () => href,
			pushHandoffs: reads,
			now: () => time,
		});
		return {
			reads,
			navigateTo,
			clicks,
			advance: (ms: number) => (time += ms),
		};
	}

	it('publishes a hand-off the page read as a click, its data the hand-off, routing nowhere', () => {
		const s = setup();
		s.reads.set({id: 1, url: ROOT, handoff});
		expect(get(s.clicks.clicks)).toEqual({id: 1, url: ROOT, data: handoff});
		// each once
		s.reads.set({id: 1, url: ROOT, handoff});
		expect(get(s.clicks.clicks)?.id).toBe(1);
		expect(s.navigateTo).not.toHaveBeenCalled();
	});

	it("routes and publishes a worker click's URL without its hand-off", () => {
		const url = withPushHandoff(ROOT, handoff);
		// from the root: already there
		const atRoot = setup();
		atRoot.clicks.take({url, data: {...handoff, navigate: url}});
		expect(atRoot.navigateTo).not.toHaveBeenCalled();
		expect(get(atRoot.clicks.clicks)).toEqual({
			id: 1,
			url: ROOT,
			data: {...handoff, navigate: url},
		});
		// from another page: to the root, without it
		const elsewhere = setup(`${ROOT}demo/`);
		elsewhere.clicks.take({url: withPushHandoff(`${ROOT}#/x`, handoff)});
		expect(elsewhere.navigateTo).toHaveBeenCalledWith(`${ROOT}#/x`);
		expect(get(elsewhere.clicks.clicks)?.url).toBe(`${ROOT}#/x`);
	});

	it('does not publish twice the click of a tab the worker opened on the hand-off', () => {
		const s = setup();
		const url = withPushHandoff(ROOT, handoff);
		s.reads.set({id: 1, url: ROOT, handoff});
		s.advance(2_000);
		s.clicks.take({url, data: {...handoff, navigate: url}});
		expect(get(s.clicks.clicks)).toEqual({id: 1, url: ROOT, data: handoff});
		// the next one is a click again
		s.clicks.take({url, data: {...handoff, navigate: url}});
		expect(get(s.clicks.clicks)?.id).toBe(2);
	});

	it('publishes a later click carrying the same hand-off (another message of the conversation)', () => {
		const s = setup();
		const url = withPushHandoff(ROOT, handoff);
		s.reads.set({id: 1, url: ROOT, handoff});
		s.advance(SAME_CLICK_WINDOW_MS + 1);
		s.clicks.take({url, data: handoff});
		expect(get(s.clicks.clicks)?.id).toBe(2);
	});
});
