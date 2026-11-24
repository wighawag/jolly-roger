import {get, writable, type Readable} from 'svelte/store';
import {errorMessage} from '$lib/core/utils/format/error';

/**
 * The value of a polling store: either not-yet-loaded, or loaded with a payload.
 * `T` is the loaded payload shape (e.g. `{value: bigint}`).
 */
export type PollingValue<T> = {step: 'Unloaded'} | ({step: 'Loaded'} & T);

/** Loading / error status, tracked alongside the value. */
export type PollingStatus = {
	loading: boolean;
	error?: {message: string; cause?: unknown};
	/** Timestamp (ms) of the last successful fetch, preserved across errors. */
	lastSuccessfulFetch?: number;
};

export type PollingStore<T> = {
	subscribe: Readable<PollingValue<T>>['subscribe'];
	status: Readable<PollingStatus>;
	/** Force an immediate refetch; resolves with the current value. */
	update(): Promise<PollingValue<T>>;
};

/** Default ceiling for exponential backoff between failed fetches (ms). */
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

type Options<S> = {
	/** Base interval between successful fetches (ms). */
	fetchInterval: number;
	/** Ceiling for exponential backoff on repeated failures (ms). */
	maxBackoff?: number;
	/**
	 * Optional source store gating the fetch. When provided:
	 * - the loop only fetches while the source is truthy,
	 * - a change in the source (by `key`) triggers an immediate refetch,
	 * - the source going falsy resets the store to `Unloaded`.
	 * Used for account/signer-scoped pollers.
	 */
	source?: {
		store: Readable<S>;
		/** Identity used to detect a meaningful source change (default: identity). */
		key?: (value: S) => unknown;
	};
};

/**
 * A store that polls `fetch` on an interval, tracks loading/error status, backs
 * off exponentially on failure, and (optionally) rescopes to a source store.
 *
 * `fetch` returns the loaded payload or throws; the engine owns everything else
 * (state/status stores, backoff, lifecycle, timers). Polling starts on the
 * first subscriber and stops on the last (svelte start-notifier), matching the
 * previous hand-rolled stores.
 */
export function createPollingStore<T, S = unknown>(
	fetch: (source: S) => Promise<T>,
	options: Options<S>,
): PollingStore<T> {
	const {fetchInterval, source} = options;
	const maxBackoff = options.maxBackoff ?? DEFAULT_MAX_BACKOFF_MS;
	const keyOf = source?.key ?? ((v: S) => v);

	let $value: PollingValue<T> = {step: 'Unloaded'};
	const _value = writable<PollingValue<T>>($value, start);

	let $status: PollingStatus = {loading: false};
	const _status = writable<PollingStatus>($status);

	let $source: S = source ? get(source.store) : (undefined as S);

	function setValue(value: PollingValue<T>) {
		$value = value;
		_value.set($value);
	}
	function setStatus(status: PollingStatus) {
		$status = status;
		_status.set($status);
	}

	// Which fetches may still write. A fetch records the generation it started
	// in and drops its result if that has moved on: a reset (the last subscriber
	// leaving, or the source going falsy) or a new source. Without it, a fetch
	// started under a subscription that has since gone wrote `Loaded` back AFTER
	// stop() had reset the store, and a fetch for the previous source could land
	// after the one for the current source. Both left the store saying something
	// its own lifecycle had already withdrawn, and a reader that peeks with
	// svelte's `get()` (subscribe, read, unsubscribe) sees those leftovers.
	let generation = 0;

	function reset() {
		generation++;
		setValue({step: 'Unloaded'});
		setStatus({loading: false});
	}

	/**
	 * One fetch. Resolves with whether it succeeded and, on success, the value it
	 * loaded, which `update()` hands back even when the store no longer accepts
	 * it (see `generation`): the caller asked for a fresh read and got one.
	 */
	async function fetchState(
		source: S,
	): Promise<{ok: true; value: PollingValue<T>} | {ok: false}> {
		const startedIn = generation;
		// Keep any existing error while (re)loading: a retry stays visibly in the
		// error/retrying state until it actually succeeds, so consumers don't flicker
		// (error vanishes then reappears). The `loading` flag lets them show a
		// "refreshing" affordance on top of the persisted error. Cleared on success.
		setStatus({
			loading: true,
			error: $status.error,
			lastSuccessfulFetch: $status.lastSuccessfulFetch,
		});
		try {
			const payload = await fetch(source);
			const value: PollingValue<T> = {step: 'Loaded', ...payload};
			if (startedIn === generation) {
				setValue(value);
				setStatus({loading: false, lastSuccessfulFetch: Date.now()});
			}
			return {ok: true, value};
		} catch (err) {
			if (startedIn !== generation) return {ok: false};
			setStatus({
				loading: false,
				error: {
					// `errorMessage`, not an `instanceof Error` guard. A great many
					// fetch failures arrive as plain objects (a viem request error, a
					// JSON-RPC payload passed straight through), and the guard threw
					// away the wording every one of them carried, replacing it with
					// this constant. Whatever reads this - a health banner, a
					// diagnostic trace - then reported a generic failure for a node
					// that had said exactly what was wrong. `cause` still carries the
					// whole value for anything that wants to expand it.
					message: errorMessage(err, 'fetch failed'),
					cause: err,
				},
				lastSuccessfulFetch: $status.lastSuccessfulFetch,
			});
			return {ok: false};
		}
	}

	let consecutiveErrors = 0;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	// Guard against a fetch that was already in-flight when stop() ran: without
	// it, the finally-block below would re-arm the timer after we stopped (a
	// polling leak the previous hand-rolled stores each had).
	let running = false;

	function clearTimer() {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
	}

	async function fetchContinuously(): Promise<PollingValue<T> | undefined> {
		// A source that is present but falsy means "nothing to fetch".
		if (source && !$source) {
			reset();
			clearTimer();
			return undefined;
		}
		clearTimer();

		let interval = fetchInterval;
		try {
			const result = await fetchState($source);
			if (result.ok) {
				consecutiveErrors = 0;
			} else {
				consecutiveErrors++;
				interval = Math.min(
					fetchInterval * Math.pow(2, consecutiveErrors),
					maxBackoff,
				);
			}
			return result.ok ? result.value : undefined;
		} finally {
			// Only re-arm if still running (not stopped mid-fetch).
			if (running && !timeout) {
				timeout = setTimeout(fetchContinuously, interval);
			}
		}
	}

	let unsubscribeFromSource: (() => void) | undefined;

	function start() {
		// Off-browser (SSR / prerender) the store stays at its idle value: no
		// fetch, no timer. Polling belongs to a browser session, and a server
		// render must neither perform IO nor leave a timer behind. Subscribing
		// there is therefore inert rather than an error. See ADR-0002
		// (`work` branch, docs/adr/).
		if (typeof window === 'undefined') return;

		running = true;
		if (source) {
			unsubscribeFromSource = source.store.subscribe((next) => {
				const changed = keyOf($source) !== keyOf(next);
				if (!changed) return;
				$source = next;
				// Whatever is in flight was for the previous source.
				generation++;
				if (next) {
					fetchContinuously();
				} else {
					reset();
					clearTimer();
				}
			});
		}
		fetchContinuously();
		return stop;
	}

	function stop() {
		running = false;
		reset();
		if (unsubscribeFromSource) {
			unsubscribeFromSource();
			unsubscribeFromSource = undefined;
		}
		clearTimer();
	}

	async function update(): Promise<PollingValue<T>> {
		// Re-read the gate before fetching. The cached `$source` is only kept in
		// step by the subscription `start()` opens, so a store nobody is subscribed
		// to still holds whatever the gate said at construction: an explicit
		// "fetch now" would then be refused on stale grounds (gated stores are
		// typically falsy at construction, being disconnected). `update` is a
		// direct request, so it asks the gate itself rather than trusting a cache
		// that may never have been updated.
		if (source) {
			$source = get(source.store);
		}
		// The value THIS fetch loaded, not whatever the store holds once it
		// settles: a reset while it was in flight (a peeking `get()` that
		// unsubscribed, say) empties the store, and the caller, who asked for a
		// fresh read and got one, would otherwise be told there is nothing.
		return (await fetchContinuously()) ?? $value;
	}

	return {
		subscribe: _value.subscribe,
		status: {subscribe: _status.subscribe},
		update,
	};
}
