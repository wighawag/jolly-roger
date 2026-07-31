import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	createPollingStore,
	DEFAULT_MAX_BACKOFF_MS,
	type PollingValue,
} from '$lib/core/connection/polling-store';

const INTERVAL = 1000;

/** Subscribe so the svelte start-notifier fires; returns an unsubscribe. */
function activate<T>(store: {subscribe: (r: (v: T) => void) => () => void}) {
	return store.subscribe(() => {});
}

describe('createPollingStore', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fetches on first subscribe and loads the payload', async () => {
		const fetch = vi.fn(async () => ({value: 1n}));
		const store = createPollingStore(fetch, {fetchInterval: INTERVAL});

		const off = activate(store);
		await vi.waitFor(() =>
			expect((get(store) as PollingValue<{value: bigint}>).step).toBe('Loaded'),
		);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(get(store)).toEqual({step: 'Loaded', value: 1n});
		off();
	});

	it('repolls on the interval', async () => {
		const fetch = vi.fn(async () => ({value: 1n}));
		const store = createPollingStore(fetch, {fetchInterval: INTERVAL});
		const off = activate(store);

		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(INTERVAL);
		expect(fetch).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(INTERVAL);
		expect(fetch).toHaveBeenCalledTimes(3);
		off();
	});

	it('records an error and preserves lastSuccessfulFetch across a later failure', async () => {
		let call = 0;
		const fetch = vi.fn(async () => {
			call++;
			if (call === 2) throw new Error('boom');
			return {value: BigInt(call)};
		});
		const store = createPollingStore(fetch, {fetchInterval: INTERVAL});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store.status).loading).toBe(false));
		const afterFirst = get(store.status).lastSuccessfulFetch;
		expect(afterFirst).toBeGreaterThan(0);

		// Second poll fails.
		await vi.advanceTimersByTimeAsync(INTERVAL);
		const status = get(store.status);
		expect(status.error?.message).toBe('boom');
		// preserved, not cleared, on error
		expect(status.lastSuccessfulFetch).toBe(afterFirst);
		off();
	});

	it('keeps the error visible while a retry is loading (cleared only on success)', async () => {
		let call = 0;
		let resolveThird: ((v: {value: bigint}) => void) | undefined;
		const fetch = vi.fn(async () => {
			call++;
			if (call === 1) return {value: 1n};
			if (call === 2) throw new Error('boom');
			// Third call: keep it pending so we can observe the loading+error state.
			return new Promise<{value: bigint}>((res) => {
				resolveThird = res;
			});
		});
		const store = createPollingStore(fetch, {fetchInterval: INTERVAL});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store.status).loading).toBe(false));
		// Second poll fails -> error set.
		await vi.advanceTimersByTimeAsync(INTERVAL);
		expect(get(store.status).error?.message).toBe('boom');

		// Third poll starts (retry). After one failure the next attempt is scheduled
		// with exponential backoff (min(INTERVAL * 2^1, maxBackoff)); advance past it.
		await vi.advanceTimersByTimeAsync(INTERVAL * 2);
		const retrying = get(store.status);
		expect(retrying.loading).toBe(true);
		expect(retrying.error?.message).toBe('boom'); // not cleared while retrying

		// Retry succeeds -> error cleared.
		resolveThird?.({value: 3n});
		await vi.waitFor(() => expect(get(store.status).loading).toBe(false));
		expect(get(store.status).error).toBeUndefined();
		off();
	});

	it('backs off exponentially on consecutive failures, capped at maxBackoff', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('down');
		});
		const store = createPollingStore(fetch, {
			fetchInterval: INTERVAL,
			maxBackoff: 8 * INTERVAL,
		});
		const off = activate(store);

		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		// after 1 error: interval = min(1000 * 2^1, 8000) = 2000
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetch).toHaveBeenCalledTimes(2);
		// after 2 errors: min(1000 * 2^2, 8000) = 4000
		await vi.advanceTimersByTimeAsync(4000);
		expect(fetch).toHaveBeenCalledTimes(3);
		// after 3 errors: min(1000 * 2^3, 8000) = 8000 (capped)
		await vi.advanceTimersByTimeAsync(8000);
		expect(fetch).toHaveBeenCalledTimes(4);
		off();
	});

	it('does not fetch while a provided source is falsy, and fetches when it becomes truthy', async () => {
		const account = writable<string | undefined>(undefined);
		const fetch = vi.fn(async (addr: string | undefined) => ({addr}));
		const store = createPollingStore(fetch, {
			fetchInterval: INTERVAL,
			source: {store: account},
		});
		const off = activate(store);

		// No source yet -> Unloaded, no fetch.
		expect(fetch).not.toHaveBeenCalled();
		expect(get(store)).toEqual({step: 'Unloaded'});

		account.set('0xabc');
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect(get(store)).toEqual({step: 'Loaded', addr: '0xabc'});
		off();
	});

	it('refetches when the source changes and resets when it goes falsy', async () => {
		const account = writable<string | undefined>('0xa');
		const fetch = vi.fn(async (addr: string | undefined) => ({addr}));
		const store = createPollingStore(fetch, {
			fetchInterval: INTERVAL,
			source: {store: account},
		});
		const off = activate(store);

		await vi.waitFor(() =>
			expect(get(store)).toEqual({step: 'Loaded', addr: '0xa'}),
		);

		account.set('0xb');
		await vi.waitFor(() =>
			expect(get(store)).toEqual({step: 'Loaded', addr: '0xb'}),
		);

		account.set(undefined);
		expect(get(store)).toEqual({step: 'Unloaded'});
		off();
	});

	it('update() forces an immediate refetch and resolves with the value', async () => {
		let n = 0;
		const fetch = vi.fn(async () => ({value: BigInt(++n)}));
		const store = createPollingStore(fetch, {fetchInterval: INTERVAL});
		const off = activate(store);

		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		const result = await store.update();
		expect(result).toEqual({step: 'Loaded', value: 2n});
		off();
	});

	it('stops polling after the last subscriber leaves', async () => {
		const fetch = vi.fn(async () => ({value: 1n}));
		const store = createPollingStore(fetch, {fetchInterval: INTERVAL});
		const off = activate(store);

		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		off(); // last subscriber gone -> stop()
		await vi.advanceTimersByTimeAsync(INTERVAL * 5);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('exposes a sane default max backoff', () => {
		expect(DEFAULT_MAX_BACKOFF_MS).toBe(60_000);
	});
});
