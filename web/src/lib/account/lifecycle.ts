import {readable, type Readable} from 'svelte/store';
import type {StoreLifecycleState} from 'synqable';

/**
 * Where the CURRENT account's data is in its life, as one value.
 *
 * - `no-account`: nothing is connected, so there is no data to wait for.
 * - `loading`: an account is connected and its data has not loaded yet. Reads
 *   answer "not known", and a writer has no handle (`writer()` is `undefined`).
 * - `ready`: loaded; reads are real and writes go through the handle.
 * - `error`: the load failed. It does not recover by itself (synqable's
 *   `retryLoad()` starts again), and it must not be shown as an empty account:
 *   "we could not read your data" and "you have none" call for different things.
 *
 * `account` is on every arm that has one, so a consumer can tell that a
 * `loading` after a `ready` is a DIFFERENT account's load (a switch) rather than
 * the same data going away.
 */
export type AccountDataLifecycle =
	| {status: 'no-account'}
	| {status: 'loading'; account: `0x${string}`}
	| {status: 'ready'; account: `0x${string}`}
	| {status: 'error'; account: `0x${string}`; error: Error};

/** The part of synqable's multi-account store this reads. */
export type LifecycleSource = {
	readonly state$: Readable<StoreLifecycleState>;
};

function fromStoreState(state: StoreLifecycleState): AccountDataLifecycle {
	switch (state.status) {
		case 'ready':
			return {status: 'ready', account: state.account};
		case 'error':
			return {status: 'error', account: state.account, error: state.loadError};
		case 'loading':
			return {status: 'loading', account: state.account};
		case 'idle':
			// Since synqable 0.2.1 an `idle` with no account means exactly "no
			// account connected". With one, it is a store created for a connect or a
			// switch whose load has not started yet: still "this account's data is
			// not here yet".
			return state.account === undefined
				? {status: 'no-account'}
				: {status: 'loading', account: state.account};
	}
}

function sameLifecycle(a: AccountDataLifecycle, b: AccountDataLifecycle) {
	return (
		a.status === b.status &&
		('account' in a ? a.account : undefined) ===
			('account' in b ? b.account : undefined) &&
		('error' in a ? a.error : undefined) ===
			('error' in b ? b.error : undefined)
	);
}

/**
 * The lifecycle of whichever account is current, derived from the
 * multi-account store's `state$`, one emission per CHANGE: a store's `idle`
 * and `loading` are both `loading` here, and a consumer reacting to "loading
 * again" should see it once per load, not once per internal step of it.
 *
 * Subscribing to it starts the multi-account store, like any of its readables.
 */
export function createAccountDataLifecycle(
	source: LifecycleSource,
): Readable<AccountDataLifecycle> {
	return readable<AccountDataLifecycle>({status: 'no-account'}, (set) => {
		let last: AccountDataLifecycle | undefined;
		return source.state$.subscribe((state) => {
			const next = fromStoreState(state);
			if (last && sameLifecycle(last, next)) return;
			last = next;
			set(next);
		});
	});
}
