/**
 * Utility for subscribing to account data map changes with automatic
 * account switching support.
 */

import type {
	Schema,
	MapKeys,
	ExtractMapItem,
	SyncableStore,
	DataOf,
} from 'synqable';

/**
 * Minimal interface for a subscribable multi-account store.
 * This allows the function to work with any store that follows the pattern.
 */
export interface SubscribableMultiAccountStore<S extends Schema> {
	subscribe: (callback: (store: SyncableStore<S> | null) => void) => () => void;
}

/**
 * Item type with deleteAt included, matching what SyncableStore returns for map items.
 */
export type MapItemWithDeleteAt<
	S extends Schema,
	K extends MapKeys<S>,
> = ExtractMapItem<S[K]> & {deleteAt: number};

/**
 * Handlers for map item changes.
 */
export interface AccountDataMapHandlers<
	S extends Schema,
	K extends MapKeys<S>,
> {
	/** Called when a new item is added to the map */
	onAdded: (key: string, item: MapItemWithDeleteAt<S, K>) => void;
	/** Called when an existing item is updated (optional) */
	onUpdated?: (key: string, item: MapItemWithDeleteAt<S, K>) => void;
	/** Called when an item is removed from the map */
	onRemoved: (key: string) => void;
	/** Called when the account changes or disconnects - should clear local state */
	onClear: () => void;
	/** Called when initial data is ready - receives all current map items */
	onInitialData?: (data: Record<string, MapItemWithDeleteAt<S, K>>) => void;
}

/**
 * Creates a subscription that syncs map items from a MultiAccountStore
 * to handlers, automatically managing account switches.
 *
 * This provides:
 * - Automatic cleanup and re-subscription on account changes
 * - Incremental add/update/remove events for efficient updates
 * - Bulk sync when store becomes ready via onInitialData
 *
 * @example
 * ```typescript
 * const unsubscribe = subscribeToAccountDataMap({
 *   accountData,
 *   mapKey: 'operations',
 *   handlers: {
 *     onAdded: (key, item) => console.log('Added:', key, item),
 *     onUpdated: (key, item) => console.log('Updated:', key, item),
 *     onRemoved: (key) => console.log('Removed:', key),
 *     onClear: () => console.log('Cleared'),
 *     onInitialData: (data) => console.log('Initial:', data),
 *   },
 * });
 * ```
 */
export function subscribeToAccountDataMap<
	S extends Schema,
	K extends MapKeys<S>,
>(params: {
	accountData: SubscribableMultiAccountStore<S>;
	mapKey: K;
	handlers: AccountDataMapHandlers<S, K>;
}): () => void {
	const {accountData, mapKey, handlers} = params;

	let currentAccountSubscription:
		{account: `0x${string}`; unsubscribe: () => void} | undefined;

	const unsubscribeFromAccountData = accountData.subscribe(
		(currentAccountData) => {
			if (currentAccountData) {
				if (
					!currentAccountSubscription ||
					currentAccountSubscription.account !== currentAccountData.account
				) {
					currentAccountSubscription?.unsubscribe();
					handlers.onClear();

					// Build event names
					const addedEvent = `${String(mapKey)}:added`;
					const updatedEvent = `${String(mapKey)}:updated`;
					const removedEvent = `${String(mapKey)}:removed`;

					// Dynamic event name from generic map key - synqable types don't expose dynamic event subscriptions
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const unsubFromAdded = (currentAccountData.on as any)(
						addedEvent,
						(data: {key: string; item: MapItemWithDeleteAt<S, K>}) => {
							handlers.onAdded(data.key, data.item);
						},
					);

					// Only subscribe to updated events if handler is provided
					let unsubFromUpdated: (() => void) | undefined;
					if (handlers.onUpdated) {
						// Dynamic event name from generic map key - synqable types don't expose dynamic event subscriptions
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						unsubFromUpdated = (currentAccountData.on as any)(
							updatedEvent,
							(data: {key: string; item: MapItemWithDeleteAt<S, K>}) => {
								handlers.onUpdated!(data.key, data.item);
							},
						);
					}

					// Dynamic event name from generic map key - synqable types don't expose dynamic event subscriptions
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const unsubFromRemoved = (currentAccountData.on as any)(
						removedEvent,
						(data: {key: string}) => {
							handlers.onRemoved(data.key);
						},
					);

					const unsubFromState = currentAccountData.state$.subscribe(
						(state) => {
							if (state.status === 'ready' && handlers.onInitialData) {
								const currentState = currentAccountData.get();
								if (currentState && currentState.status === 'ready') {
									const data = currentState.data as DataOf<S>;
									const mapData = data[mapKey as keyof DataOf<S>] as Record<
										string,
										MapItemWithDeleteAt<S, K>
									>;
									handlers.onInitialData(mapData);
								}
							}
						},
					);

					currentAccountSubscription = {
						account: currentAccountData.account,
						unsubscribe: () => {
							unsubFromAdded();
							unsubFromUpdated?.();
							unsubFromRemoved();
							unsubFromState();
						},
					};
				}
			} else {
				currentAccountSubscription?.unsubscribe();
				currentAccountSubscription = undefined;
				handlers.onClear();
			}
		},
	);

	return unsubscribeFromAccountData;
}
