import 'fake-indexeddb/auto';
import {describe, expect, it} from 'vitest';
import {
	deleteWorldIndex,
	indexerWorkerFor,
	worldIndexDatabasePrefix,
} from '$lib/indexer/worker-choice';

/**
 * Which chains are a world is the APP's to say (`indexerWorkerFor`'s
 * `isWorld`): template-commit-reveal passes `isEmbeddedChainId`. These tests
 * name a range of their own, so this file needs no embedded chain.
 */
const MIN_WORLD_ID = 9_007_199_254_740_000;
const MAX_WORLD_ID = 9_007_199_254_740_991;
const isWorld = (id: number) => id >= MIN_WORLD_ID && id <= MAX_WORLD_ID;

const PREFIX = 'mygame';
const GAME = '0x00000000000000000000000000000000000000Aa' as const;

function openDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onsuccess = () => {
			request.result.close();
			resolve();
		};
		request.onerror = () => reject(request.error);
	});
}

async function names(): Promise<string[]> {
	return (await indexedDB.databases()).map((d) => d.name!).sort();
}

describe("a game's indexer worker", () => {
	it('a chain the app calls a world gets the world worker, named by its chain id', () => {
		for (const id of [MIN_WORLD_ID, MAX_WORLD_ID]) {
			expect(indexerWorkerFor(PREFIX, {chain: {id}}, GAME, {isWorld})).toEqual({
				kind: 'world',
				name: `mygame-world-${id}`,
			});
		}
	});

	it('no chain is a world unless the app says which are', () => {
		for (const id of [MIN_WORLD_ID, 31337]) {
			expect(indexerWorkerFor(PREFIX, {chain: {id}}, GAME)).toEqual({
				kind: 'live',
				name: `mygame-${id}-${GAME.toLowerCase()}`,
			});
		}
		expect(
			indexerWorkerFor(PREFIX, {chain: {id: MIN_WORLD_ID}}, GAME, {
				isWorld: () => false,
			}).kind,
		).toBe('live');
	});

	it('any other chain gets the live worker, its election named per deployment', () => {
		const local = indexerWorkerFor(PREFIX, {chain: {id: 31337}}, GAME, {
			isWorld,
		});
		expect(local).toEqual({
			kind: 'live',
			name: `mygame-31337-${GAME.toLowerCase()}`,
		});
		const base = indexerWorkerFor(PREFIX, {chain: {id: 8453}}, GAME);
		expect(base.kind).toBe('live');
		// two deployments never share an election
		expect(base.name).not.toBe(local.name);
		expect(
			indexerWorkerFor(PREFIX, {chain: {id: 31337}}, `0x${'bb'.repeat(20)}`)
				.name,
		).not.toBe(local.name);
		// nor do two games
		expect(indexerWorkerFor('other', {chain: {id: 31337}}, GAME).name).not.toBe(
			local.name,
		);
	});

	it('forgetting a world deletes its databases, and only its', async () => {
		const world = MIN_WORLD_ID + 5;
		const other = MIN_WORLD_ID + 50;
		await openDatabase(`${worldIndexDatabasePrefix(PREFIX, world)}-stream-a`);
		await openDatabase(`${worldIndexDatabasePrefix(PREFIX, world)}-stream-b`);
		await openDatabase(`${worldIndexDatabasePrefix(PREFIX, other)}-stream-a`);
		await openDatabase('mygame-31337-x');
		await deleteWorldIndex(PREFIX, world);
		// deletions are queued, not awaited: let them run
		await new Promise((resolve) => setTimeout(resolve, 20));
		const left = await names();
		expect(left).not.toContain(
			`${worldIndexDatabasePrefix(PREFIX, world)}-stream-a`,
		);
		expect(left).not.toContain(
			`${worldIndexDatabasePrefix(PREFIX, world)}-stream-b`,
		);
		expect(left).toContain(
			`${worldIndexDatabasePrefix(PREFIX, other)}-stream-a`,
		);
		expect(left).toContain('mygame-31337-x');
	});

	it('does nothing where IndexedDB cannot list its databases', async () => {
		const deleted: string[] = [];
		const factory = {
			deleteDatabase: (name: string) => deleted.push(name),
		} as unknown as IDBFactory;
		await expect(deleteWorldIndex(PREFIX, 1, factory)).resolves.toBeUndefined();
		expect(deleted).toEqual([]);
	});

	it("another game's world of the same id is not this game's", async () => {
		const world = MIN_WORLD_ID + 9;
		await openDatabase(`${worldIndexDatabasePrefix('other', world)}-stream`);
		await deleteWorldIndex(PREFIX, world);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(await names()).toContain(
			`${worldIndexDatabasePrefix('other', world)}-stream`,
		);
	});

	it('a world whose id is a prefix of another is not the other', async () => {
		const world = MIN_WORLD_ID + 7;
		await openDatabase(`${worldIndexDatabasePrefix(PREFIX, world)}0-stream`);
		await deleteWorldIndex(PREFIX, world);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(await names()).toContain(
			`${worldIndexDatabasePrefix(PREFIX, world)}0-stream`,
		);
	});
});
