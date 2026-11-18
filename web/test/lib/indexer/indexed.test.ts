// No `.svelte.` infix, so this runs in the `server` project: node, no DOM.
// The chain is hardhat's, in this process (`deployInProcess`), deployed by the
// repo's own deploy scripts; IndexedDB is `fake-indexeddb`.
import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it} from 'vitest';
import {get, writable} from 'svelte/store';
import {createBrowserStateStore, createIndexerState} from '@etherfold/browser';
import {graphqlQueryHandler} from '@etherfold/graphql/worker';
import {
	declareEntities,
	fromEntityProcessor,
	openForWriting,
	type EntityProcessor,
} from '@etherfold/processor-entities';
import {deployInProcess} from 'jolly-roger-contracts/utils/in-process-chain.js';
import {createIndexed, type IndexedValue} from '$lib/indexer/indexed';
import {
	StateQueryError,
	type StateFollowerSpec,
	type StateRead,
} from '$lib/indexer/follower';

/**
 * THE INDEXED STORE (`$lib/indexer/indexed.ts`), on a host on this thread
 * folding the repo's own GreetingsRegistry: a toy processor counting every
 * greeting, so this file holds the store to the chain and not to the app's
 * processor (that is `test/lib/onchain/indexer.test.ts`).
 */

const entities = declareEntities([
	{name: 'total', id: 'id', fields: {greetings: 'integer'}},
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const counting: EntityProcessor<any> = {
	entities,
	async onMessageChanged(state) {
		const row = (await state.get('total', {id: 'all'})) as
			{greetings: number} | undefined;
		state.set('total', {id: 'all'}, {greetings: (row?.greetings ?? 0) + 1});
	},
};

type Data = {greetings: number};

const totalFollower: StateFollowerSpec<'total', Data> = {
	parts: ['total'],
	partOf: {total: 'total'},
	async read(execute, _parts, {at}) {
		const result = await execute({
			query: `{ total(first: 1) { greetings } }`,
		});
		if (result.errors?.length) {
			throw new StateQueryError(result.errors[0].message, undefined);
		}
		const rows = (result.data as {total: {greetings: number}[]}).total;
		return {
			data: {greetings: Number(rows[0]?.greetings ?? 0)},
			block:
				typeof at === 'number' ? at : (result.extensions?.block ?? undefined),
			blockHash: result.extensions?.blockHash ?? undefined,
		} satisfies StateRead<Data>;
	},
};

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()!();
});

async function chainWithGreetings(count: number) {
	const chain = await deployInProcess();
	cleanups.push(chain.close);
	const registry = chain.env.get('GreetingsRegistry');
	const [first] = chain.env.unnamedAccounts;
	async function greet(message: string) {
		await chain.env.execute(
			registry as never,
			{
				functionName: 'setMessage',
				args: [message],
				account: first,
			} as never,
		);
	}
	for (let i = 0; i < count; i++) await greet(`hello ${i}`);
	const source = {
		chainId: '31337',
		contracts: [
			{
				abi: registry.abi.filter(
					(entry: {type: string; name?: string}) =>
						entry.type === 'event' && entry.name === 'MessageChanged',
				),
				address: registry.address,
			},
		],
	};
	const store = await createBrowserStateStore(entities, {
		databaseName: `indexed-test-${Date.now()}-${Math.random()}`,
	});
	const indexer = createIndexerState({
		createState: async (_context, {signal}) => openForWriting(store, {signal}),
		createProcessor: (state) => fromEntityProcessor(counting)(state),
	});
	await indexer.init({
		provider: chain.provider as never,
		source: source as never,
		config: {stream: {finality: 12}},
	});
	await indexer.indexToLatest();
	cleanups.push(() => indexer.dispose?.());
	return {chain, greet, indexer, source};
}

async function until<T>(
	read: () => T,
	ok: (value: T) => boolean,
	what: string,
): Promise<T> {
	for (let i = 0; i < 300; i++) {
		const value = read();
		if (ok(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`timed out waiting for ${what}`);
}

describe('an indexed store', () => {
	it("publishes the follower's read of what the host folded, and reads again when asked", async () => {
		const {chain, greet, indexer, source} = await chainWithGreetings(3);
		const indexed = createIndexed({
			provider: chain.provider as never,
			worker: {kind: 'live', name: 'indexed-test'},
			host: () => indexer.mainThreadHost({query: graphqlQueryHandler()}),
			source,
			finality: 12,
			follower: totalFollower,
		});
		let value: IndexedValue<Data> = {};
		const stop = indexed.subscribe((next) => (value = next));
		cleanups.push(stop);

		const first = await until(
			() => value,
			(v) => v.read !== undefined,
			'the first read',
		);
		expect(first.read?.data).toEqual({greetings: 3});
		expect(first.error).toBeUndefined();

		await greet('one more');
		await indexer.indexToLatest();
		await indexed.refresh();
		const again = await until(
			() => value,
			(v) => v.read?.data.greetings === 4,
			'the read after a fourth greeting',
		);
		expect(again.read?.data).toEqual({greetings: 4});
	}, 60_000);

	it('says a read failed, keeps the last good one, and clears the error once a read lands', async () => {
		const {chain, indexer, source} = await chainWithGreetings(2);
		let failNext = false;
		const flaky: StateFollowerSpec<'total', Data> = {
			...totalFollower,
			read: (...args) => {
				if (failNext) {
					failNext = false;
					return Promise.reject(
						new StateQueryError(
							'rows-examined-bound: too many',
							'rows-examined-bound',
						),
					);
				}
				return totalFollower.read(...args);
			},
		};
		const indexed = createIndexed({
			provider: chain.provider as never,
			worker: {kind: 'live', name: 'indexed-test'},
			host: () => indexer.mainThreadHost({query: graphqlQueryHandler()}),
			source,
			finality: 12,
			follower: flaky,
		});
		let value: IndexedValue<Data> = {};
		cleanups.push(indexed.subscribe((next) => (value = next)));
		await until(
			() => value,
			(v) => v.read !== undefined,
			'the first read',
		);

		failNext = true;
		await indexed.refresh();
		const failed = await until(
			() => value,
			(v) => v.error !== undefined,
			'the error',
		);
		expect(failed.error).toMatchObject({
			kind: 'query',
			message: 'rows-examined-bound: too many',
		});
		// the last good read stays: a failed read is not an empty state
		expect(failed.read?.data).toEqual({greetings: 2});

		await indexed.refresh();
		const recovered = await until(
			() => value,
			(v) => v.error === undefined,
			'the error to clear',
		);
		expect(recovered.read?.data).toEqual({greetings: 2});
	}, 60_000);

	it('starts nothing while its gate is closed, and starts once it opens', async () => {
		const {chain, indexer, source} = await chainWithGreetings(1);
		const gate = writable(false);
		let hosts = 0;
		const indexed = createIndexed({
			provider: chain.provider as never,
			worker: {kind: 'live', name: 'indexed-test'},
			host: () => {
				hosts++;
				return indexer.mainThreadHost({query: graphqlQueryHandler()});
			},
			source,
			finality: 12,
			follower: totalFollower,
			gate,
		});
		let value: IndexedValue<Data> = {};
		cleanups.push(indexed.subscribe((next) => (value = next)));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(hosts).toBe(0);
		expect(value).toEqual({});

		gate.set(true);
		const read = await until(
			() => value,
			(v) => v.read !== undefined,
			'the read once the gate opened',
		);
		expect(hosts).toBe(1);
		expect(read.read?.data).toEqual({greetings: 1});
	}, 60_000);

	it('starts no worker outside a browser', () => {
		let started = 0;
		const indexed = createIndexed({
			provider: {request: async () => undefined} as never,
			worker: {kind: 'live', name: 'indexed-test'},
			startWorker: () => {
				started++;
				throw new Error('no worker here');
			},
			source: {},
			finality: 12,
			follower: totalFollower,
		});
		expect(get(indexed)).toEqual({});
		expect(started).toBe(0);
	});

	it('is refused without a worker or a host', () => {
		expect(() =>
			createIndexed({
				provider: {request: async () => undefined} as never,
				worker: {kind: 'live', name: 'indexed-test'},
				source: {},
				finality: 12,
				follower: totalFollower,
			}),
		).toThrow(/needs the app's worker \(startWorker\) or a host/);
	});
});
