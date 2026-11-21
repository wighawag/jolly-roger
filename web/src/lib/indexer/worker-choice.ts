/**
 * WHICH INDEXER WORKER AN APP'S STATE RUNS, and the name it is given.
 *
 * - A chain in this tab (an offline world: the app says which chains are one,
 *   `isWorld`; template-commit-reveal passes `isEmbeddedChainId`) is indexed by
 *   the app's WORLD worker (`hostWorldIndexer`): no tab election, since no
 *   other tab can reach this tab's chain, and no publication, since nobody
 *   publishes a snapshot of a world. Its IndexedDB database is named after the
 *   world (the name below, which carries the minted chain id), kept across
 *   reloads, and deleted with the world (`deleteWorldIndex`).
 * - Any other chain is indexed by the app's LIVE worker (`hostLiveIndexer`),
 *   ONE TAB INDEXING and the others reading, under an election named PER
 *   DEPLOYMENT (chain and contract address). etherfold names the election by
 *   what the worker is told, so a name shared across deployments would have an
 *   online tab and a world in another tab contend for one lease, and the loser
 *   read a database nobody wrote (found in stratagems, step O of its plan).
 *
 * The name crosses as the worker's own (`new Worker(url, {name})`, read there as
 * `self.name`), because the worker's code is fixed at build time and the
 * deployment is not.
 *
 * `prefix` is the APP's: a short lower-case word naming it (stratagems says
 * `stratagems`), so two apps served from one origin never share a database.
 *
 * WHICH CHAINS ARE A WORLD IS INJECTED (`isWorld`), and by default none is:
 * this module is jolly-roger's, `with/indexer`, which stems from `main` and so
 * has no chain in the tab. An app that has one (`with/embedded-chain`, and
 * template-commit-reveal's offline world) passes its own test.
 */

export type IndexerWorker = {
	kind: 'world' | 'live';
	/** The worker's name: its election (live) or its database prefix (world). */
	name: string;
};

/** The prefix of every IndexedDB database an offline world's indexer writes. */
export function worldIndexDatabasePrefix(
	prefix: string,
	chainId: number,
): string {
	return `${prefix}-world-${chainId}`;
}

export type IndexerWorkerOptions = {
	/** Whether a chain id is a chain in this tab (an offline world); never, when left out. */
	isWorld?: (chainId: number) => boolean;
};

export function indexerWorkerFor(
	prefix: string,
	deployment: {chain: {id: number}},
	gameAddress: `0x${string}`,
	options: IndexerWorkerOptions = {},
): IndexerWorker {
	const chainId = deployment.chain.id;
	if (options.isWorld?.(chainId)) {
		return {kind: 'world', name: worldIndexDatabasePrefix(prefix, chainId)};
	}
	return {
		kind: 'live',
		name: `${prefix}-${chainId}-${gameAddress.toLowerCase()}`,
	};
}

/**
 * Delete every index an offline world left, best-effort: called when the world
 * is forgotten. Not awaited by a boot, since a database still held by a stopping
 * worker blocks its deletion until that worker lets go.
 */
export async function deleteWorldIndex(
	prefix: string,
	chainId: number,
	factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<void> {
	if (!factory?.databases) return;
	const world = worldIndexDatabasePrefix(prefix, chainId);
	const databases = await factory.databases();
	for (const {name} of databases) {
		if (name && (name === world || name.startsWith(`${world}-`))) {
			factory.deleteDatabase(name);
		}
	}
}
