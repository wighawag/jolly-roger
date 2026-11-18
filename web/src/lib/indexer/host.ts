/**
 * WHERE A GAME'S INDEXER RUNS: the bodies of its two worker entries.
 *
 * A game keeps two files of its own, each about ten lines, because the bundler
 * has to see `new Worker(new URL(...))` and the processor's import in the
 * game's code (see `./README.md`):
 *
 * ```ts
 * // the game's indexer.worker.ts
 * import {hostLiveIndexer} from '$lib/indexer/host';
 * import {myProcessor} from './processor';
 * hostLiveIndexer({processor: myProcessor, databasePrefix: 'mygame', finality: 12});
 *
 * // the game's indexer.world.worker.ts
 * import {hostWorldIndexer} from '$lib/indexer/host';
 * import {myProcessor} from './processor';
 * hostWorldIndexer({processor: myProcessor});
 * ```
 *
 * `hostLiveIndexer` is a live chain's: ONE TAB INDEXES and the others read
 * (etherfold ADR-0097), under the election the tab names the worker by
 * (`./worker-choice.ts`, per deployment), and it starts from a published
 * snapshot when the tab hands it a publication. Its processor is either
 * IMPORTED (`processor`) or the PUBLISHED BUNDLE (`processorBundle`): a
 * published snapshot is keyed by the SHA-256 of the bundle's bytes, so a game
 * that publishes one runs the very bytes its snapshot job folded with, fetched
 * from the app's root (`appRoot`), and no other.
 *
 * `hostWorldIndexer` is an offline world's: no election (no other tab can read
 * this tab's chain), no publication (nobody snapshots a world), and its
 * database named by the world (the worker's own name) and the stream, kept
 * across reloads. That is not a store that can disagree with the restored
 * chain: webevm saves its dump after every mined block and awaits the save
 * before the request returns, so the index never holds a block the saved chain
 * lacks; after a reload it is at most behind, and folds forward.
 *
 * GraphQL is answered in the worker, where the store is (etherfold ADR-0099);
 * the tab reads it with a follower (`./follower.ts`).
 *
 * Written first in stratagems (its `board/indexer.worker.ts` and
 * `indexer.embedded.worker.ts`).
 */
import {
	createBrowserStateStore,
	hostIndexerInThisWorker,
	type InstantiatedProcessorBundle,
} from '@etherfold/browser';
import {graphqlQueryHandler} from '@etherfold/graphql/worker';
import {
	EntityEventProcessor,
	openForWriting,
	stateFactoriesFrom,
	type EntityProcessor,
} from '@etherfold/processor-entities';
import type {BootstrapOutcome} from '@etherfold/processor-entities';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProcessor = EntityProcessor<any>;

/**
 * Where the app is served from, read off a worker's own URL: a published bundle
 * is a static file at the app's root, and the app is deployed under paths
 * nobody knows in advance (IPFS gateways), so no absolute path is right. A
 * built worker lives under SvelteKit's `_app/immutable/`; in development Vite
 * serves it from `src/`.
 */
export function appRoot(href: string = self.location.href): string {
	for (const marker of ['/_app/immutable/', '/src/lib/']) {
		const at = href.indexOf(marker);
		if (at >= 0) return href.slice(0, at + 1);
	}
	throw new Error(
		`cannot tell where the app is served from, given this worker's URL ${href}`,
	);
}

export type LiveIndexerOptions = (
	| {
			/** The processor, imported as a module (a game that publishes no snapshot). */
			processor: AnyProcessor;
			processorBundle?: undefined;
	  }
	| {
			processor?: undefined;
			/** The published bundle's URL, e.g. `new URL('processor.bundle.js', appRoot())`. */
			processorBundle: {url: URL};
	  }
) & {
	/** The game's word (`./worker-choice.ts`): the database is `<prefix>-<stream>`. */
	databasePrefix: string;
	/** The finality the stream runs under: a published snapshot inside the reorg window is refused. */
	finality: number;
	/** Told what installing a published snapshot did (a refusal is data, not an error). */
	onBootstrap?: (outcome: BootstrapOutcome) => void;
};

function processorOf(
	options: LiveIndexerOptions,
	bundle: InstantiatedProcessorBundle | undefined,
): AnyProcessor {
	if (options.processor) return options.processor;
	if (!bundle) {
		throw new Error(
			`the ${options.databasePrefix} worker runs the published processor bundle, and none arrived`,
		);
	}
	return bundle.processor as AnyProcessor;
}

/** The body of a game's live worker entry. */
export function hostLiveIndexer(options: LiveIndexerOptions): void {
	hostIndexerInThisWorker({
		...(options.processorBundle
			? {processorBundle: options.processorBundle}
			: {}),
		// THE STORE, named ONCE: `stateFactoriesFrom` derives both seats of the
		// tab election from this one constructor, so the reader always opens the
		// database the leader writes. One database per stream (source and stream
		// config), so a redeploy's source never lands in the rows of the previous
		// one.
		...stateFactoriesFrom({
			open: (context, entities) =>
				createBrowserStateStore(entities, {
					databaseName: `${options.databasePrefix}-${context.stream}`,
				}),
			...(options.processor ? {entities: options.processor.entities} : {}),
			finalityDepth: options.finality,
			onBootstrap: (outcome) => {
				options.onBootstrap?.(outcome);
				if (outcome.status === 'not-bootstrapped') {
					// said out loud: the tab then indexes from the start block
					console.warn(
						`the published snapshot was not installed (${outcome.reason}): indexing from the start block`,
					);
				}
			},
		}),
		createProcessor: (state, _context, bundle) =>
			new EntityEventProcessor(state, processorOf(options, bundle)),
		// ONE TAB INDEXES, THE OTHERS READ, named per deployment by the tab.
		tabElection: {name: self.name || options.databasePrefix},
		query: graphqlQueryHandler(),
	});
}

/** The body of a game's offline-world worker entry. */
export function hostWorldIndexer(options: {processor: AnyProcessor}): void {
	/** Given by the tab (`new Worker(url, {name})`): `<prefix>-world-<chainId>`. */
	const worldName = self.name;
	if (!worldName) {
		throw new Error(
			`an offline world's indexer worker was started without the world's name`,
		);
	}
	hostIndexerInThisWorker({
		createState: async (context, {signal}) =>
			openForWriting(
				await createBrowserStateStore(options.processor.entities, {
					databaseName: `${worldName}-${context.stream}`,
				}),
				{signal},
			),
		createProcessor: (state) =>
			new EntityEventProcessor(state as never, options.processor),
		query: graphqlQueryHandler(),
	});
}
