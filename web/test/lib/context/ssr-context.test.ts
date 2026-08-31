import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {get} from 'svelte/store';
import {createContext} from '$lib/context/index';

// This file has no `.svelte.` infix, so it runs in the `server` vitest project:
// Node, no DOM. That is the same environment SvelteKit uses to prerender, which
// makes it the real harness for the SSR-inert contract in ADR-0002:
//
//   constructing a service never touches a browser API, subscribing never
//   starts IO on the server, and all IO starts in start().
//
// `get()` subscribes and immediately unsubscribes, so every read below also
// fires that store's start-notifier: exactly what a server render does.

describe('app context off-browser', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('runs with no DOM', () => {
		expect(typeof window).toBe('undefined');
	});

	it('constructs, leaves every store idle, and starts no timer', () => {
		// Not awaited: createContext is synchronous, which is what lets the
		// layout provide it during a server render.
		const {context} = createContext();

		// The connection rests where @etherplay/connect leaves it with no
		// window to auto-connect from. This is also the browser's first render,
		// which is why hydration matches.
		//
		// `pendingRequests` is part of that resting shape as of 0.11.0, which moved
		// the list off the wallet object and stamps it on EVERY publish, including
		// the states that carry no wallet. An empty array here is the point of that
		// change rather than noise: there is one shape, and "nothing is outstanding"
		// is said rather than left to be inferred from a missing field.
		expect(get(context.connection)).toEqual({
			step: 'Idle',
			loading: true,
			wallets: [],
			pendingRequests: [],
		});
		expect(get(context.account)).toBe(undefined);

		// Pollers stay unloaded: no fetch, no interval.
		expect(get(context.accountBalance)).toEqual({step: 'Unloaded'});
		expect(get(context.gasFee)).toEqual({step: 'Unloaded'});
		expect(get(context.accountBalance.status)).toEqual({loading: false});
		expect(get(context.gasFee.status)).toEqual({loading: false});

		// navigator/window absent means "not offline", not a crash.
		expect(get(context.offline)).toEqual({offline: false});

		// Nothing scheduled anything: a prerender must not leave work behind.
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not install the debug global', () => {
		createContext();
		expect((globalThis as Record<string, unknown>).context).toBe(undefined);
	});
});
