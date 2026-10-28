import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {
	createMultiAccountStore,
	createSyncableStore,
	defineSchema,
	map,
	type AccountWithSigner,
	type AsyncStorage,
	type InternalStorage,
} from 'synqable';
import {subscribeToAccountDataMap} from '../../../../../src/lib/core/utils/data/account-data-subscription';

/**
 * The map subscription follows the multi-account store's CURRENT STORE. A
 * signer rotated for the same address is a new store (synqable keys stores by
 * account AND private key, and stops the old one for good), so a subscription
 * that followed the address went on listening to a stopped store.
 */

const OWNER = '0x00000000000000000000000000000000000a11ce' as const;
const KEY_1 = `0x${'1'.repeat(64)}` as const;
const KEY_2 = `0x${'2'.repeat(64)}` as const;

const schema = defineSchema({items: map<{n: number}>()});

function memory(): AsyncStorage<InternalStorage<typeof schema>> {
	const saved = new Map<string, InternalStorage<typeof schema>>();
	return {
		load: async (key) => structuredClone(saved.get(key)),
		save: async (key, data) => void saved.set(key, structuredClone(data)),
		remove: async (key) => void saved.delete(key),
		exists: async (key) => saved.has(key),
	};
}

describe('subscribeToAccountDataMap', () => {
	it('follows the new store when the signer changes for the same address', async () => {
		const storage = memory();
		const account = writable<AccountWithSigner | undefined>({
			owner: OWNER,
			privateKey: KEY_1,
		});
		const multi = createMultiAccountStore({
			schema,
			accountStore: account,
			factory: (address) =>
				createSyncableStore({
					schema,
					account: address,
					defaultData: () => ({items: {}}),
					clock: () => 1000,
					storage: {adapterFactory: () => storage, key: `items_${address}`},
				}),
		});

		const added: string[] = [];
		const onClear = vi.fn();
		const unsubscribe = subscribeToAccountDataMap({
			accountData: multi,
			mapKey: 'items',
			handlers: {
				onAdded: (key) => added.push(key),
				onRemoved: () => {},
				onClear,
			},
		});
		try {
			await multi.ready();
			multi.writer()!.addItem('items', 'a', {n: 1}, {deleteAt: 10_000});
			expect(added).toEqual(['a']);

			const first = multi.get();
			account.set({owner: OWNER, privateKey: KEY_2});
			expect(multi.get()).not.toBe(first);
			expect(onClear).toHaveBeenCalledTimes(2);

			await multi.ready();
			multi.writer()!.addItem('items', 'b', {n: 2}, {deleteAt: 10_000});
			expect(added).toEqual(['a', 'b']);
		} finally {
			unsubscribe();
		}
	});
});
