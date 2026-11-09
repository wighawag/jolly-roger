import {expose, type Endpoint} from 'comlink';
import {createIndexedDBPersistence, type NodeOptions} from 'webevm';
import {createNodeWorkerApi} from 'webevm/worker-host';

/**
 * THE WORKER SIDE OF THE OFFLINE WORLD'S NODE: webevm's own worker api, with
 * the one thing it cannot be handed from the page built here instead.
 *
 * `createWorkerNode` structured-clones the node's options into the Worker, and
 * a persistence adapter is an object with methods, so it cannot cross (a
 * `DataCloneError`); `exposeNode`'s host options only take an engine. So the
 * page sends the DATABASE NAME, which is a string and clones, and the adapter
 * is built on the thread that will use it. Everything else passes through to
 * webevm's api unchanged, which is what keeps the proxy it hands back the one
 * `Required<SlimNode>` proxy webevm maintains rather than a copy of it.
 *
 * Its own module rather than the Worker entry itself, so a test can expose it
 * on one end of a `MessageChannel` and drive it with the real client.
 */
export type OfflineNodeOptions = Omit<NodeOptions, 'persistence' | 'engine'> & {
	/** Persist the chain in the IndexedDB database of this name, in the Worker. */
	indexedDB?: string;
};

export function offlineNodeApi() {
	const api = createNodeWorkerApi();
	return {
		createNode(options: OfflineNodeOptions) {
			const {indexedDB, ...rest} = options;
			return api.createNode({
				...rest,
				...(indexedDB
					? {persistence: createIndexedDBPersistence({db: indexedDB})}
					: {}),
			});
		},
	};
}

/**
 * Expose the api on `endpoint` (the Worker's own scope by default). Called
 * synchronously at the entry's module scope, with nothing awaited before it:
 * webevm measured that a Worker module awaiting first can lose the page's
 * first message (`webevm/worker-host`, `exposeNode`).
 */
export function exposeOfflineNode(endpoint?: Endpoint): void {
	expose(offlineNodeApi(), endpoint);
}
