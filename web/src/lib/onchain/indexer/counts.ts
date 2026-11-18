/**
 * HOW MANY GREETINGS EACH ACCOUNT HAS SENT, from the greetings' indexer, and the
 * view that shows it BESIDE the direct read (the service-layers spec's R6): the
 * poll of `getLastMessages` stays what the list is, and each message gains an
 * optional `greetingCount`, absent while the indexer has not answered, is
 * syncing, or is unreachable (R2: the list then renders as on `main`).
 */
import {derived, type Readable} from 'svelte/store';
import type {EIP1193Provider} from 'viem';
import {
	createIndexed,
	type IndexedStore,
	type IndexerHost,
} from '$lib/indexer/indexed';
import {indexerWorkerFor} from '$lib/indexer/worker-choice';
import type {
	MessageView,
	ViewStateStore,
	ViewStateValue,
} from '$lib/view/index';
import {countsFollower, type GreetingCounts} from './queries';
import {
	INDEXER_PREFIX,
	indexingSource,
	STREAM_FINALITY,
	type ContractsInfo,
} from './source';

export function createGreetingCounts(params: {
	/** The framework's chain provider (`connection.provider`). */
	provider: EIP1193Provider;
	deployments: ContractsInfo;
	/** The app's `chainFetchGate`: index only while the chain can be read. */
	gate?: Readable<boolean>;
	/** A test's host, in place of the worker. */
	host?: () => IndexerHost;
}): IndexedStore<GreetingCounts> {
	return createIndexed({
		provider: params.provider,
		worker: indexerWorkerFor(
			INDEXER_PREFIX,
			params.deployments,
			params.deployments.contracts.GreetingsRegistry.address,
		),
		startWorker: (worker) =>
			new Worker(new URL('./indexer.worker.ts', import.meta.url), {
				type: 'module',
				name: worker.name,
			}),
		host: params.host,
		source: indexingSource(params.deployments),
		finality: STREAM_FINALITY,
		follower: countsFollower,
		gate: params.gate,
	});
}

/** A message, with how many greetings its account has sent when the indexer has said. */
export type CountedMessageView = MessageView & {greetingCount?: number};

export type CountedViewStateValue =
	| Extract<ViewStateValue, {step: 'Unloaded'}>
	| {step: 'Loaded'; messages: CountedMessageView[]};

export type CountedViewStateStore = Omit<ViewStateStore, 'subscribe'> & {
	subscribe: Readable<CountedViewStateValue>['subscribe'];
};

/** Each message's `greetingCount`, from `counts` when it holds the account. Pure. */
export function withCounts(
	value: ViewStateValue,
	counts: ReadonlyMap<string, number> | undefined,
): CountedViewStateValue {
	if (value.step !== 'Loaded' || !counts) return value;
	return {
		step: 'Loaded',
		messages: value.messages.map((message) => {
			const greetingCount = counts.get(message.account.toLowerCase());
			return greetingCount === undefined
				? message
				: {...message, greetingCount};
		}),
	};
}

/** The view, with the counts laid over it; its status is the view's own. */
export function withGreetingCounts(
	viewState: ViewStateStore,
	counts: Readable<{read?: {data: GreetingCounts}}>,
): CountedViewStateStore {
	const value = derived(
		[{subscribe: viewState.subscribe}, counts],
		([$view, $counts]) => withCounts($view, $counts.read?.data.counts),
	);
	return {subscribe: value.subscribe, status: viewState.status};
}
