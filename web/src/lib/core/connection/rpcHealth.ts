import {writable, type Readable} from 'svelte/store';
import type {PollingStatus} from './polling-store';

export type RpcErrorCategory =
	| 'network'
	| 'timeout'
	| 'rate-limit'
	| 'server-error'
	| 'unknown';

export type RpcError = {
	category: RpcErrorCategory;
	message: string;
	since: number;
};

export type RpcHealthValue = {
	healthy: boolean;
	error: RpcError | null;
};

export type RpcHealthStore = Readable<RpcHealthValue>;

/**
 * Extracts a meaningful error message from an error object,
 * looking at the cause chain if the top-level message is a wrapper.
 */
function extractErrorMessage(error: {
	message: string;
	cause?: unknown;
}): string {
	// If there's a cause, try to get a more specific message from it
	if (error.cause) {
		const cause = error.cause as Record<string, unknown>;

		// Check for common error properties
		if (typeof cause.message === 'string') {
			return cause.message;
		}
		if (typeof cause.details === 'string') {
			return cause.details;
		}
		if (typeof cause.shortMessage === 'string') {
			return cause.shortMessage;
		}
		// For viem errors, check for specific error info
		if (typeof cause.status === 'number') {
			return `HTTP ${cause.status}`;
		}
		// Recursively check nested cause
		if (cause.cause && typeof cause.cause === 'object') {
			const nested = cause.cause as Record<string, unknown>;
			if (typeof nested.message === 'string') {
				return nested.message;
			}
		}
	}

	// Fall back to the wrapper message
	return error.message;
}

function categorizeError(error: {
	message: string;
	cause?: unknown;
}): RpcErrorCategory {
	// Extract the actual error message, looking at cause if available
	const errorMessage = extractErrorMessage(error);
	const msg = errorMessage.toLowerCase();

	if (
		msg.includes('timeout') ||
		msg.includes('timed out') ||
		msg.includes('aborted')
	)
		return 'timeout';
	if (
		msg.includes('429') ||
		msg.includes('rate limit') ||
		msg.includes('too many requests')
	)
		return 'rate-limit';
	if (
		msg.includes('500') ||
		msg.includes('502') ||
		msg.includes('503') ||
		msg.includes('504') ||
		msg.includes('internal server error')
	)
		return 'server-error';
	if (
		msg.includes('network') ||
		msg.includes('fetch') ||
		msg.includes('econnrefused') ||
		msg.includes('enotfound') ||
		msg.includes('failed to fetch')
	)
		return 'network';
	return 'unknown';
}

/** Something exposing a `status` store of PollingStatus (balance, gasFee, ...). */
export type HealthInput = {status: Readable<PollingStatus>};

/** The last SETTLED outcome of an input, ignoring transient loading states. */
export type SettledOutcome =
	| {state: 'ok'}
	| {state: 'error'; error: {message: string; cause?: unknown}}
	| {state: 'pending'};

/**
 * Fold a raw PollingStatus into a settled outcome. A status is only meaningful
 * once it is NOT loading: while loading, the poller clears its error (see
 * polling-store.fetchState), so treating the loading blip as "ok" would flip
 * health healthy mid-retry and cause the banner to flicker. We therefore return
 * `pending` while loading and let the caller keep the previous settled outcome.
 */
export function settle(status: PollingStatus): SettledOutcome {
	if (status.loading) return {state: 'pending'};
	if (status.error) return {state: 'error', error: status.error};
	// Not loading and no error. Count as ok only if it has actually fetched
	// successfully at least once; a never-run (idle/gated) input is `pending` so
	// it neither hides a real outage nor forces one.
	if (status.lastSuccessfulFetch) return {state: 'ok'};
	return {state: 'pending'};
}

/** A settled outcome plus the real time it was observed. */
export type TimedOutcome = {outcome: SettledOutcome; at: number};

/**
 * Decide health from each input's last settled outcome and WHEN it settled. All
 * inputs read the SAME chain via the same transport, so what matters is the
 * most recent settle across inputs: if the latest thing we observed was a
 * success, the RPC is reachable now (healthy); if it was an error, it is not.
 *
 * Using the real observation time (captured by the store, not synthesized here)
 * means:
 * - a fresh success (5s onchain poll, or a Retry) heals immediately, even if a
 *   slow poller (10-min gas) still holds an older error;
 * - a fresh error shows the banner, even if a slow poller still holds an older
 *   success;
 * - an in-flight retry stays `pending` and does not change the last settle, so
 *   nothing flickers.
 */
export function computeHealth(timed: TimedOutcome[]): {
	healthy: boolean;
	error: {message: string; cause?: unknown} | null;
} {
	let latest: TimedOutcome | null = null;
	for (const t of timed) {
		if (t.outcome.state === 'pending') continue;
		if (!latest || t.at >= latest.at) {
			latest = t;
		}
	}
	if (latest && latest.outcome.state === 'error') {
		return {healthy: false, error: latest.outcome.error};
	}
	return {healthy: true, error: null};
}

export function createRpcHealthStore(params: {
	inputs: HealthInput[];
}): RpcHealthStore {
	const {inputs} = params;

	let $state: RpcHealthValue = {healthy: true, error: null};
	let errorSince: number | undefined;
	// Per-input last settled outcome + real observation time. Loading blips do
	// not overwrite it, so a retry (error -> loading -> error/ok) never
	// momentarily reads as healthy.
	const timed: TimedOutcome[] = inputs.map(() => ({
		outcome: {state: 'pending'},
		at: 0,
	}));

	function setState(state: RpcHealthValue) {
		$state = state;
		store.set($state);
	}

	function updateHealth() {
		const {healthy, error} = computeHealth(timed);

		if (!healthy && error) {
			if (!errorSince) {
				errorSince = Date.now();
			}
			setState({
				healthy: false,
				error: {
					category: categorizeError(error),
					message: extractErrorMessage(error),
					since: errorSince,
				},
			});
			return;
		}

		errorSince = undefined;
		setState({healthy: true, error: null});
	}

	let unsubscribes: (() => void)[] = [];

	function start() {
		unsubscribes = inputs.map((input, i) =>
			input.status.subscribe((status) => {
				const next = settle(status);
				// Keep the previous settled outcome while pending (loading), so an
				// in-flight retry does not transiently flip health. Record the real
				// time of each settle so the most recent one decides health.
				if (next.state !== 'pending') {
					timed[i] = {outcome: next, at: Date.now()};
				}
				updateHealth();
			}),
		);
		return stop;
	}

	function stop() {
		errorSince = undefined;
		setState({healthy: true, error: null});
		for (const u of unsubscribes) u();
		unsubscribes = [];
	}

	// Create the writable store with start/stop lifecycle
	const store = writable<RpcHealthValue>({healthy: true, error: null}, start);

	return {
		subscribe: store.subscribe,
	};
}
