/**
 * Index a chain IN THIS NODE PROCESS with etherfold, and read the result with
 * GraphQL: what a game's contract tests, its unit tests and its scripts share
 * when they need its indexed state outside a browser (`with/indexer`, see
 * `web/src/lib/indexer/README.md`).
 *
 * A Node process keeps state in SQLite (etherfold has no filesystem storage,
 * its ADR-0041), so this is `createIndexerState` (the same hook the browser
 * uses) over a `VersionedStateStore` (`@etherfold/state-store-sqlite`) on
 * libSQL, `:memory:` by default or a file, which keeps the rows AND the sync
 * cursor, so a file-backed run resumes where the last one stopped.
 *
 * What is read back goes through GraphQL built from the processor's own entity
 * declarations (`localExecutor`), because a store has no "every row" read: that
 * is a query, and it is the one the web app asks too (the game's `read`, which
 * its follower runs).
 *
 * Written first in stratagems (its `contracts/utils/indexer.ts`).
 */
import {createClient} from '@libsql/client';
import {RemoteLibSQL} from 'remote-sql-libsql';
import {VersionedStateStore} from '@etherfold/state-store-sqlite';
import {
	fromEntityProcessor,
	openForWriting,
	type EntityProcessor,
} from '@etherfold/processor-entities';
import {createIndexerState} from '@etherfold/browser';
import {
	buildQuerySchema,
	localExecutor,
	queryBlocksOf,
	type QueryExecutor,
} from '@etherfold/graphql';
import type {EIP1193CoreProvider} from 'eip-1193';

export type IndexedInProcess = {
	/** GraphQL over the indexed state, pinned to one block per operation. */
	execute: QueryExecutor;
	/** Index what the chain has added since. */
	indexToLatest(): Promise<unknown>;
	close(): void;
};

export async function indexInProcess<ABI extends readonly unknown[]>(options: {
	processor: EntityProcessor<any>;
	/**
	 * What etherfold reads the chain through. Since @etherfold/browser 0.13 its
	 * slot is eip-1193 0.7's `EIP1193CoreProvider` (the methods wallet, node and
	 * HTTP node providers all serve), which a hardhat or rocketh provider
	 * satisfies, so it is passed without a cast.
	 */
	provider: EIP1193CoreProvider;
	source: {
		chainId: string;
		genesisHash?: `0x${string}`;
		contracts: readonly {
			abi: ABI;
			address: `0x${string}`;
			startBlock?: number;
		}[];
	};
	/** A libSQL url: `:memory:` (the default) or `file:./.data/<name>.db`. */
	db?: string;
	finality?: number;
}): Promise<IndexedInProcess> {
	const client = createClient({url: options.db ?? ':memory:'});
	const store = new VersionedStateStore(
		new RemoteLibSQL(client as never),
		options.processor.entities,
	);
	const indexer = createIndexerState({
		// claimed: this process writes the store
		createState: async (_context, {signal}) => openForWriting(store, {signal}),
		createProcessor: (state) => fromEntityProcessor(options.processor)(state),
	});
	await indexer.init({
		provider: options.provider,
		source: options.source as never,
		...(options.finality !== undefined
			? {config: {stream: {finality: options.finality}}}
			: {}),
	});
	await indexer.indexToLatest();

	const execute = localExecutor(
		buildQuerySchema(options.processor.entities),
		() => ({
			accessor: store.accessor(),
			generation: 'in-process',
			tip: () => store.tip(),
			asOf: store.capabilities.asOf,
			// the block reads and revert sequence: every answer names its block's hash, and
			// no operation is answered from two branches
			blocks: queryBlocksOf(store),
		}),
	);

	return {
		execute,
		indexToLatest: () => indexer.indexToLatest(),
		close: () => client.close(),
	};
}
