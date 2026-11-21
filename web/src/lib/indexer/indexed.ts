/**
 * AN APP'S INDEXED STATE, as one store: an etherfold processor folding the
 * chain in a worker (`./host.ts`, through the app's worker entry), and this tab
 * reading it back through GraphQL with a follower (`./follower.ts`: one full
 * read, then only the parts whose entities moved).
 *
 * What it publishes is the follower's last read (`read`: the data and the one
 * block it is as of), the worker's own progress (`progress`, for a syncing
 * indicator), and why the indexed read should not be trusted right now
 * (`error`): the worker REFUSED this tab, the indexer STOPPED, or a QUERY
 * failed. A failed query keeps the last good read (a refused read is not an
 * empty state) and its error clears once a read lands; a refusal or a stop is
 * not recovered here.
 *
 * IT IS READ BESIDE THE DIRECT READ, NEVER INSTEAD OF IT (the service-layers
 * spec's R6): an app adds an optional field from this store and keeps its own
 * chain read, so an indexer that is unreachable, refused or still syncing
 * leaves the app working, with that field absent (R2).
 *
 * THE WORKER READS THROUGH THE PROVIDER IT IS HANDED: the framework's
 * `connection.provider`, the app's RPC when there is one and the wallet's
 * otherwise. Give it the app's `chainFetchGate` as `gate` and it starts only
 * once the chain can be read, and stops when it no longer can.
 *
 * Started by its first subscriber, in the browser only (or on a test's
 * `host`), and stopped by its last.
 *
 * jolly-roger's (`with/indexer`); template-commit-reveal's `indexed-state.ts`
 * is built on this one, adding a game's cycle stamp and the mapping onto its
 * state seam.
 */
import {
	connectToIndexerHost,
	createProgressReadable,
	dedicatedWorkerHost,
	type HostProgress,
	type IndexerPort,
} from '@etherfold/browser';
import {workerExecutor} from '@etherfold/graphql/worker';
import {readable, writable, type Readable} from 'svelte/store';
import type {EIP1193Provider} from 'viem';
import {logs} from 'named-logs';
import {
	createStateFollower,
	type Execute,
	type StateFollower,
	type StateFollowerSpec,
	type StateRead,
} from './follower';
import type {IndexerWorker} from './worker-choice';

const logger = logs('indexer:indexed');

/** An etherfold host a port can join: a worker (`dedicatedWorkerHost`) or, in a test, `indexer.mainThreadHost()`. */
export type IndexerHost = Parameters<typeof connectToIndexerHost>[0];

/** Why the indexed read is not to be trusted now. */
export type IndexedError = {
	/** `refused`: the worker refused this tab; `stopped`: the indexer stopped; `query`: a read failed. */
	readonly kind: 'refused' | 'stopped' | 'query';
	readonly message: string;
	readonly cause?: unknown;
};

export type IndexedValue<Data> = {
	/** The last read, as of one block; absent until the first lands. */
	readonly read?: StateRead<Data>;
	/** The worker's own progress; absent until it has said. */
	readonly progress?: HostProgress;
	readonly error?: IndexedError;
};

export type IndexedStore<Data> = Readable<IndexedValue<Data>> & {
	/** Read everything again (a no-op while nothing is subscribed). */
	refresh(): Promise<void>;
};

export type IndexedOptions<Part extends string, Data> = {
	/** The chain the worker folds: the framework's (`connection.provider`). */
	provider: EIP1193Provider;
	/** Which worker, and its name (`indexerWorkerFor`). */
	worker: IndexerWorker;
	/**
	 * The worker, started by the APP's code with a literal
	 * `new Worker(new URL('./x.worker.ts', import.meta.url), {type: 'module', name})`
	 * so the bundler sees the entry. A test hands `host` instead.
	 */
	startWorker?: (worker: IndexerWorker) => Worker;
	/** The host itself, when it is not a dedicated worker (a test's `mainThreadHost`). */
	host?: () => IndexerHost;
	/** What is indexed: the app's contracts and the events its processor folds. */
	source: unknown;
	/** The stream's finality: part of the digest a publication is found by. */
	finality: number;
	/** Where the publication index is, for a live chain whose snapshot job publishes one. */
	publication?: () => {locations: string[]} | undefined;
	/** The app's parts and how to read them. */
	follower: StateFollowerSpec<Part, Data>;
	/** Who is reading, for a part that depends on it (`accountPart`). */
	account?: Readable<string | undefined>;
	/** Run only while this is truthy (the app's `chainFetchGate`); always when left out. */
	gate?: Readable<boolean>;
};

export function createIndexed<Part extends string, Data>(
	options: IndexedOptions<Part, Data>,
): IndexedStore<Data> {
	if (!options.startWorker && !options.host) {
		throw new Error(
			`an indexed store needs the app's worker (startWorker) or a host`,
		);
	}
	const value = writable<IndexedValue<Data>>({});
	let follower: StateFollower<Data> | undefined;

	function connect(
		onConnect: (outcome: {accepted: boolean; error?: unknown}) => void,
	): IndexerPort {
		// A test's host is already initialised with its provider and source, and
		// lives on this thread: nothing to hand it, and nothing to watch.
		if (options.host) {
			return connectToIndexerHost(options.host(), {watch: false, onConnect});
		}
		const startWorker = options.startWorker!;
		const publication =
			options.worker.kind === 'live' ? options.publication?.() : undefined;
		return connectToIndexerHost(
			dedicatedWorkerHost(() => startWorker(options.worker)),
			{
				provider: options.provider as never,
				settings: {
					source: options.source as never,
					config: {stream: {finality: options.finality}},
					// a world has no publication (nobody snapshots a chain in a tab)
					...(publication ? {publication} : {}),
				},
				onConnect,
			},
		);
	}

	function start(): () => void {
		let stopped = false;
		const fail = (error: IndexedError) => {
			if (!stopped) value.update((v) => ({...v, error}));
		};
		const indexer = connect((outcome) => {
			if (!outcome.accepted) {
				logger.error(`the indexer worker refused this tab`, outcome.error);
				fail({
					kind: 'refused',
					message: 'the indexer refused this tab',
					cause: outcome.error,
				});
			}
		});
		const following = createStateFollower(
			options.follower,
			workerExecutor(indexer) as Execute,
			{
				onError: (error) => {
					logger.error(`state query failed`, error);
					fail({kind: 'query', message: error.message, cause: error});
				},
			},
		);
		follower = following;
		following.onUpdate((read) => {
			if (stopped) return;
			value.update((v) => ({
				...v,
				read,
				// a read landed: a failed query is behind us, a refusal or a stop is not
				...(v.error?.kind === 'query' ? {error: undefined} : {}),
			}));
		});
		// subscribe last: a listener may be called before the code after it runs
		const progress = createProgressReadable(indexer);
		const stopProgress = progress.subscribe((next) => {
			if (stopped || next === undefined) return;
			value.update((v) => ({...v, progress: next}));
			if (next.failure) {
				logger.error(`indexer stopped`, next.failure);
				fail({
					kind: 'stopped',
					message: 'the indexer stopped',
					cause: next.failure,
				});
			}
		});
		indexer.onStateMoved((moved) => void following.moved(moved as never));
		const stopAccount = options.account?.subscribe(
			(account) => void following.setAccount(account?.toLowerCase() ?? ''),
		);
		void following.refreshAll();
		return () => {
			stopped = true;
			stopAccount?.();
			stopProgress();
			progress.close();
			follower = undefined;
			void indexer.stopIndexing().catch(() => undefined);
			indexer.close();
		};
	}

	// Started by its first subscriber, in the browser only, while the gate is
	// open, and stopped by its last.
	const lifecycle = readable<IndexedValue<Data>>({}, (set) => {
		if (typeof window === 'undefined' && !options.host) return;
		const stopValue = value.subscribe(set);
		let stop: (() => void) | undefined;
		const run = (open: boolean) => {
			if (open && !stop) stop = start();
			else if (!open && stop) {
				stop();
				stop = undefined;
			}
		};
		const stopGate = options.gate
			? options.gate.subscribe(run)
			: (run(true), undefined);
		return () => {
			stopGate?.();
			run(false);
			stopValue();
		};
	});

	return {
		subscribe: lifecycle.subscribe,
		async refresh() {
			await follower?.refreshAll();
		},
	};
}
