import {readable, type Readable} from 'svelte/store';
import type {Schema, StoreLifecycleState, SyncableStore} from 'synqable';

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
export type LifecycleSource<S extends Schema> = {
	subscribe(callback: (store: SyncableStore<S> | null) => void): () => void;
};

function fromStoreState(
	account: `0x${string}`,
	state: StoreLifecycleState,
): AccountDataLifecycle {
	switch (state.status) {
		case 'ready':
			return {status: 'ready', account};
		case 'error':
			return {status: 'error', account, error: state.loadError};
		case 'loading':
		// A per-account store is `idle` from its creation until its load starts,
		// which the multi-account store does at once. For a consumer that is still
		// "this account's data is not here yet", not "no account".
		case 'idle':
			return {status: 'loading', account};
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
 * The lifecycle of whichever account is current, derived from synqable.
 *
 * It follows the multi-account store's CURRENT STORE rather than its `state$`,
 * because `state$` cannot tell "no account" from "an account whose store has
 * just been created": both are `idle` with no account, and the second happens
 * on every switch. Following the store gives `no-account` only when there is no
 * store, and reads each store's own `state$`, whose `account` is the store's.
 *
 * Subscribing to it starts the multi-account store, like any of its readables.
 */
export function createAccountDataLifecycle<S extends Schema>(
	source: LifecycleSource<S>,
): Readable<AccountDataLifecycle> {
	return readable<AccountDataLifecycle>({status: 'no-account'}, (setValue) => {
		// One emission per CHANGE: a store's `idle` and `loading` are both
		// `loading` here, and a consumer reacting to "loading again" should see it
		// once per load, not once per internal step of it.
		let last: AccountDataLifecycle | undefined;
		const set = (next: AccountDataLifecycle) => {
			if (last && sameLifecycle(last, next)) return;
			last = next;
			setValue(next);
		};
		let unsubscribeFromState: (() => void) | undefined;
		const unsubscribeFromStore = source.subscribe((store) => {
			unsubscribeFromState?.();
			unsubscribeFromState = undefined;
			if (!store) {
				set({status: 'no-account'});
				return;
			}
			const account = store.account;
			unsubscribeFromState = store.state$.subscribe((state) =>
				set(fromStoreState(account, state)),
			);
		});
		return () => {
			unsubscribeFromState?.();
			unsubscribeFromStore();
		};
	});
}
