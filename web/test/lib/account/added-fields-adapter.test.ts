import {describe, it, expect} from 'vitest';
import {
	isWatchable,
	type AsyncStorage,
	type InternalStorage,
	type StorageChangeCallback,
	type WatchableStorage,
} from 'synqable';
import {withAddedFieldDefaults} from '../../../src/lib/account/added-fields';
import type {AccountDataSchema} from '../../../src/lib/account/AccountData';

/**
 * The adapter half of the added fields: a field missing from stored data is
 * filled from its default as the data comes OFF storage, and that includes a
 * change another tab saved (the adapter's `watch`), which `added-fields.test.ts`
 * cannot reach because its storage has no `watch`.
 */

type Stored = InternalStorage<AccountDataSchema>;

const defaults = () => ({settings: {volume: 5}, submissions: {}});

/** What a build without the added fields saved: operations only. */
function savedWithoutFields(): Stored {
	return {
		$version: 2,
		data: {operations: {}},
		$timestamps: {},
		$itemTimestamps: {operations: {}},
		$tombstones: {operations: {}},
	};
}

function watchableStorage() {
	const callbacks = new Map<string, StorageChangeCallback<Stored>>();
	const adapter: WatchableStorage<Stored> = {
		load: async () => savedWithoutFields(),
		save: async () => {},
		remove: async () => {},
		exists: async () => true,
		watch(key, callback) {
			callbacks.set(key, callback);
			return () => callbacks.delete(key);
		},
	};
	/** Another tab saved `value` under `key` (undefined: it removed it). */
	const otherTabSaves = (key: string, value: Stored | undefined) =>
		callbacks.get(key)?.(key, value);
	return {adapter, otherTabSaves, callbacks};
}

describe('withAddedFieldDefaults', () => {
	it('fills a missing added field in a change another tab saved', () => {
		const {adapter, otherTabSaves} = watchableStorage();
		const wrapped = withAddedFieldDefaults(() => adapter, defaults)();
		expect(isWatchable(wrapped)).toBe(true);

		const received: (Stored | undefined)[] = [];
		(wrapped as WatchableStorage<Stored>).watch('k', (_key, value) =>
			received.push(value),
		);
		otherTabSaves('k', savedWithoutFields());

		expect(received).toHaveLength(1);
		expect(received[0]!.data).toEqual({
			operations: {},
			settings: {volume: 5},
			submissions: {},
		});
	});

	it('never replaces a value the other tab stored', () => {
		const {adapter, otherTabSaves} = watchableStorage();
		const wrapped = withAddedFieldDefaults(
			() => adapter,
			defaults,
		)() as WatchableStorage<Stored>;
		const received: (Stored | undefined)[] = [];
		wrapped.watch('k', (_key, value) => received.push(value));

		const stored = savedWithoutFields();
		(stored.data as Record<string, unknown>).settings = {volume: 9};
		otherTabSaves('k', stored);

		expect((received[0]!.data as Record<string, unknown>).settings).toEqual({
			volume: 9,
		});
	});

	it('passes a removal through as a removal', () => {
		const {adapter, otherTabSaves} = watchableStorage();
		const wrapped = withAddedFieldDefaults(
			() => adapter,
			defaults,
		)() as WatchableStorage<Stored>;
		const received: (Stored | undefined)[] = [];
		wrapped.watch('k', (_key, value) => received.push(value));

		otherTabSaves('k', undefined);
		expect(received).toEqual([undefined]);
	});

	it('stops watching when the wrapped watch is undone', () => {
		const {adapter, callbacks} = watchableStorage();
		const wrapped = withAddedFieldDefaults(
			() => adapter,
			defaults,
		)() as WatchableStorage<Stored>;
		const unwatch = wrapped.watch('k', () => {});
		expect(callbacks.has('k')).toBe(true);
		unwatch();
		expect(callbacks.has('k')).toBe(false);
	});

	it('stays unwatchable when the adapter is', async () => {
		const plain: AsyncStorage<Stored> = {
			load: async () => savedWithoutFields(),
			save: async () => {},
			remove: async () => {},
			exists: async () => true,
		};
		const wrapped = withAddedFieldDefaults(() => plain, defaults)();
		expect(isWatchable(wrapped)).toBe(false);
		expect((await wrapped.load('k'))!.data).toMatchObject({
			settings: {volume: 5},
		});
	});
});
