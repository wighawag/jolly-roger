import {get, writable, type Readable} from 'svelte/store';

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

	function reset() {
		setValue({step: 'Unloaded'});
		setStatus({loading: false});
	}

	async function fetchState(source: S): Promise<boolean> {
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
			setValue({step: 'Loaded', ...payload});
			setStatus({loading: false, lastSuccessfulFetch: Date.now()});
			return true;
		} catch (err) {
			setStatus({
				loading: false,
				error: {
					message: err instanceof Error ? err.message : 'fetch failed',
					cause: err,
				},
				lastSuccessfulFetch: $status.lastSuccessfulFetch,
			});
			return false;
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

	async function fetchContinuously() {
		// A source that is present but falsy means "nothing to fetch".
		if (source && !$source) {
			reset();
			clearTimer();
			return;
		}
		clearTimer();

		let interval = fetchInterval;
		try {
			const success = await fetchState($source);
			if (success) {
				consecutiveErrors = 0;
			} else {
				consecutiveErrors++;
				interval = Math.min(
					fetchInterval * Math.pow(2, consecutiveErrors),
					maxBackoff,
				);
			}
		} finally {
			// Only re-arm if still running (not stopped mid-fetch).
			if (running && !timeout) {
				timeout = setTimeout(fetchContinuously, interval);
			}
		}
	}

	let unsubscribeFromSource: (() => void) | undefined;

	function start() {
		running = true;
		if (source) {
			unsubscribeFromSource = source.store.subscribe((next) => {
				const changed = keyOf($source) !== keyOf(next);
				if (!changed) return;
				$source = next;
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
		await fetchContinuously();
		return $value;
	}

	return {
		subscribe: _value.subscribe,
		status: {subscribe: _status.subscribe},
		update,
	};
}
