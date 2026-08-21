import {writable, type Readable} from 'svelte/store';

/**
 * Which wallet requests the user has stopped waiting on.
 *
 * The escape hatch's memory. A request the wallet is holding is a fact about the
 * wallet and nothing in the app may pretend otherwise, but whether to keep a
 * modal on screen about it is the app's business, and the user is allowed to say
 * "enough". This is where that answer lives, so it is app state rather than a
 * lie told to the connection store.
 *
 * BY REQUEST ID, not a boolean. Stopping waiting on one request must not
 * suppress the prompt for the next one: a user who gives up on a stuck
 * transaction and then sends another still needs to be told to confirm THAT one.
 * A flag would have made the second request silent, which is a worse bug than
 * the one the escape hatch fixes, and it would only show up on the second send.
 *
 * Held in memory on purpose. Ids belong to a provider instance, so they mean
 * nothing after a reload, and a reload is not a reason to re-block the user on a
 * modal about a request they already dismissed: the in-flight ledger is what
 * survives that, and it is the thing that actually matters.
 */
export type StoppedWaitingStore = Readable<ReadonlySet<string>> & {
	/**
	 * Stop waiting on these requests.
	 *
	 * REPLACES rather than adds, and takes the ids outstanding at this moment.
	 * The set only ever needs to describe requests the wallet is holding NOW, so
	 * rebuilding it from that list keeps it from growing for the life of the tab
	 * and keeps an id from an answered request out of the way of a later one.
	 */
	stopWaitingFor(requestIds: readonly string[]): void;
};

export function createStoppedWaiting(): StoppedWaitingStore {
	const store = writable<ReadonlySet<string>>(new Set());
	return {
		subscribe: store.subscribe,
		stopWaitingFor(requestIds) {
			store.set(new Set(requestIds));
		},
	};
}
