// No `.svelte.` infix, so this runs in the `server` project: node, no DOM.
// The chain is hardhat's, in this process (`deployInProcess`), deployed by the
// repo's own deploy scripts; IndexedDB is `fake-indexeddb`.
import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it} from 'vitest';
import {createBrowserStateStore, createIndexerState} from '@etherfold/browser';
import {graphqlQueryHandler} from '@etherfold/graphql/worker';
import {
	fromEntityProcessor,
	openForWriting,
} from '@etherfold/processor-entities';
import {deployInProcess} from 'jolly-roger-contracts/utils/in-process-chain.js';
import {indexInProcess} from 'jolly-roger-contracts/utils/indexer.js';
import {greetingsProcessor} from '$lib/onchain/indexer/processor';
import {readCounts} from '$lib/onchain/indexer/queries';
import {
	indexingSource,
	STREAM_FINALITY,
	type ContractsInfo,
} from '$lib/onchain/indexer/source';
import {createGreetingCounts, withCounts} from '$lib/onchain/indexer/counts';
import type {IndexedValue} from '$lib/indexer/indexed';
import type {GreetingCounts} from '$lib/onchain/indexer/queries';

/**
 * THE GREETINGS' INDEXER, held to the contract: two accounts send three
 * greetings (the first twice), and the processor folds GreetingsRegistry's
 * `MessageChanged` into counts of 2 and 1, two ways:
 *
 * - in this process, over SQLite (`indexInProcess`, what scripts and contract
 *   tests use);
 * - through the app's own store (`createGreetingCounts`, what the composition
 *   builds), on a host on this thread over a browser store.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()!();
});

async function threeGreetings() {
	const chain = await deployInProcess();
	cleanups.push(chain.close);
	const registry = chain.env.get('GreetingsRegistry');
	const [first, second] = chain.env.unnamedAccounts as `0x${string}`[];
	for (const [account, message] of [
		[first, 'hello'],
		[second, 'hi'],
		[first, 'hello again'],
	] as const) {
		await chain.env.execute(
			registry as never,
			{
				functionName: 'setMessage',
				args: [message],
				account,
			} as never,
		);
	}
	const deployments: ContractsInfo = {
		chain: {id: 31337},
		contracts: {
			GreetingsRegistry: {
				abi: registry.abi as never,
				address: registry.address,
			},
		},
	};
	return {chain, first, second, deployments};
}

describe("the greetings' indexer", () => {
	it('counts each account’s greetings, folded in this process', async () => {
		const {chain, first, second, deployments} = await threeGreetings();
		const indexed = await indexInProcess({
			processor: greetingsProcessor,
			provider: chain.provider as never,
			source: indexingSource(deployments) as never,
		});
		cleanups.push(() => indexed.close());
		const {data} = await readCounts(indexed.execute);
		expect(Object.fromEntries(data.counts)).toEqual({
			[first.toLowerCase()]: 2,
			[second.toLowerCase()]: 1,
		});
	}, 60_000);

	it('reaches the app through its store, as the composition builds it', async () => {
		const {chain, first, second, deployments} = await threeGreetings();
		const store = await createBrowserStateStore(greetingsProcessor.entities, {
			databaseName: `greetings-indexer-test-${Date.now()}`,
		});
		const indexer = createIndexerState({
			createState: async (_context, {signal}) =>
				openForWriting(store, {signal}),
			createProcessor: (state) =>
				fromEntityProcessor(greetingsProcessor)(state),
		});
		await indexer.init({
			provider: chain.provider as never,
			source: indexingSource(deployments) as never,
			config: {stream: {finality: STREAM_FINALITY}},
		});
		await indexer.indexToLatest();
		cleanups.push(() => indexer.dispose?.());

		const counts = createGreetingCounts({
			provider: chain.provider as never,
			deployments,
			host: () => indexer.mainThreadHost({query: graphqlQueryHandler()}),
		});
		let value: IndexedValue<GreetingCounts> = {};
		cleanups.push(counts.subscribe((next) => (value = next)));
		for (let i = 0; i < 300 && !value.read; i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(value.read).toBeDefined();
		expect(Object.fromEntries(value.read!.data.counts)).toEqual({
			[first.toLowerCase()]: 2,
			[second.toLowerCase()]: 1,
		});
	}, 60_000);
});

describe("a message's greeting count", () => {
	const A = '0x00000000000000000000000000000000000000Aa' as const;
	const B = '0x00000000000000000000000000000000000000bB' as const;
	const loaded = {
		step: 'Loaded' as const,
		messages: [
			{account: A, message: 'a', timestamp: 1},
			{account: B, message: 'b', timestamp: 2, pending: true},
		],
	};

	it('is laid over each message whose account the counts hold, compared lower-case', () => {
		const counted = withCounts(loaded, new Map([[A.toLowerCase(), 3]]));
		expect(counted).toEqual({
			step: 'Loaded',
			messages: [
				{account: A, message: 'a', timestamp: 1, greetingCount: 3},
				{account: B, message: 'b', timestamp: 2, pending: true},
			],
		});
	});

	it('is absent everywhere while the indexer has not answered: the view is the direct read', () => {
		expect(withCounts(loaded, undefined)).toBe(loaded);
		expect(withCounts({step: 'Unloaded'}, new Map())).toEqual({
			step: 'Unloaded',
		});
	});
});
