import {
	isWatchable,
	type AsyncStorage,
	type DataOf,
	type InternalStorage,
	type Schema,
	type StorageAdapterFactory,
	type WatchableStorage,
} from 'synqable';

/**
 * The schema of the fields an app adds to its account data, beside the
 * framework's own `operations`. Any synqable fields (`value`, `record`, `map`),
 * built with `defineSchema`; `operations` is the framework's and cannot be
 * redefined.
 */
export type AddedFieldsSchema = Schema & {operations?: never};

/**
 * Fields an app adds to its account data.
 *
 * - `schema` comes from synqable's `defineSchema`, so the account data's type
 *   is the framework's schema and this one together, and the app reads and
 *   writes its own fields, through the write handle, with no cast.
 * - `defaults` is what each field holds for an account that has never written
 *   it, INCLUDING an account whose data was stored before the field existed:
 *   those load with the default, not `undefined`, and a default loses to any
 *   real write when synced (it carries no timestamp).
 *
 * Choose the field type by how it must merge across devices (synqable's
 * CHANGELOG, 0.1.0): a `map` per key, a `record` per property, a `value` as
 * one unit. Adding a field needs no migration; renaming or reshaping one does.
 */
export type AddedFields<F extends AddedFieldsSchema> = {
	schema: F;
	defaults: () => DataOf<F>;
};

/**
 * The adapter, with every added field that stored data lacks filled in from
 * its default as the data comes OFF storage (a load, and a change another tab
 * saved). Only missing fields are filled: a stored value is never replaced.
 *
 * Filled here, below the store, because the store itself only fills a field on
 * an account with no data at all, and only `cleanup` gives a missing `map`
 * field its `{}`. A `value` or `record` field added to an app would otherwise
 * read as `undefined` for every existing player, which its type says cannot
 * happen.
 */
export function withAddedFieldDefaults<S extends Schema>(
	factory: StorageAdapterFactory<InternalStorage<S>>,
	defaults: () => Record<string, unknown>,
): StorageAdapterFactory<InternalStorage<S>> {
	function fill(stored: InternalStorage<S> | undefined) {
		if (!stored || typeof stored !== 'object' || !stored.data) return stored;
		const data = stored.data as Record<string, unknown>;
		let filled: Record<string, unknown> | undefined;
		for (const [field, value] of Object.entries(defaults())) {
			if (data[field] === undefined) {
				filled ??= {...data};
				filled[field] = value;
			}
		}
		return filled ? ({...stored, data: filled} as InternalStorage<S>) : stored;
	}

	return (privateKey) => {
		const adapter = factory(privateKey);
		const wrapped: AsyncStorage<InternalStorage<S>> = {
			load: async (key) => fill(await adapter.load(key)),
			save: (key, data) => adapter.save(key, data),
			remove: (key) => adapter.remove(key),
			exists: (key) => adapter.exists(key),
		};
		if (!isWatchable(adapter)) return wrapped;
		return {
			...wrapped,
			watch: (key, callback) =>
				adapter.watch(key, (changedKey, value) =>
					callback(changedKey, fill(value)),
				),
		} satisfies WatchableStorage<InternalStorage<S>>;
	};
}
