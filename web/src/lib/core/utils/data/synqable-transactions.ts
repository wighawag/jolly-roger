/**
 * Synqable utility functions for working with MultiAccountStore
 */

import type {Schema, MapKeys} from 'synqable';
import {
	subscribeToAccountDataMap,
	type SubscribableMultiAccountStore,
	type MapItemWithDeleteAt,
} from './account-data-subscription';

// Re-export for backwards compatibility
export type {SubscribableMultiAccountStore, MapItemWithDeleteAt};

/**
 * Observer interface for receiving map item changes.
 * Follows a simple add/remove/clear pattern.
 */
export interface MapObserver<T> {
	add: (key: string, value: T) => void;
	remove: (key: string) => void;
	clear: () => void;
	addMultiple: (values: {[id: string]: T}) => void;
}

/**
 * Creates a subscription that syncs map items from a MultiAccountStore
 * to an observer, handling account switches automatically.
 *
 * This provides:
 * - Automatic cleanup and re-subscription on account changes
 * - Incremental add/remove events for efficient updates
 * - Bulk sync when store becomes ready
 *
 * `extractValue` is where the observed value is BUILT, not merely picked out:
 * the caller decides what an item looks like to the observer, so a stored
 * record need not be shaped like one (see `toTransactionIntent`).
 *
 * @example
 * ```typescript
 * const unsubscribe = hookTxObserverToAccountData({
 *   accountData,
 *   mapKey: 'operations',
 *   extractValue: toTransactionIntent,
 *   observer: txObserver,
 * });
 * ```
 */
export function hookTxObserverToAccountData<
	S extends Schema,
	K extends MapKeys<S>,
	T,
>(params: {
	accountData: SubscribableMultiAccountStore<S>;
	mapKey: K;
	extractValue: (item: MapItemWithDeleteAt<S, K>) => T;
	observer: MapObserver<T>;
}): () => void {
	const {accountData, mapKey, extractValue, observer} = params;

	return subscribeToAccountDataMap({
		accountData,
		mapKey,
		handlers: {
			onAdded: (key, item) => {
				observer.add(key, extractValue(item));
			},
			onUpdated: (key, item) => {
				// Re-add with updated data (e.g., when a new transaction is added to an existing operation)
				observer.add(key, extractValue(item));
			},
			onRemoved: (key) => {
				observer.remove(key);
			},
			onClear: () => {
				observer.clear();
			},
			onInitialData: (mapData) => {
				const values: {[id: string]: T} = {};
				for (const id in mapData) {
					values[id] = structuredClone(extractValue(mapData[id])) as T;
				}
				observer.addMultiple(values);
			},
		},
	});
}
