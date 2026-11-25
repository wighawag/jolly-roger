import {describe, it, expect} from 'vitest';
import {forgetChainId, rememberChainId} from '$lib/embedded/chain-id';

/** A `localStorage`, listable, as much of it as forgetting uses. */
function listableStorage(initial?: Record<string, string>) {
	const map = new Map(Object.entries(initial ?? {}));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		get length() {
			return map.size;
		},
		key: (i: number) => [...map.keys()][i] ?? null,
		map,
	};
}

describe('forgetting an embedded world (QA F8)', () => {
	it('drops the id, so the next remember mints a new world', () => {
		const storage = listableStorage();
		const first = rememberChainId({storage, key: 'w', random: () => 0.25});
		expect(forgetChainId({storage, key: 'w'})).toBe(first);
		expect(storage.map.has('w')).toBe(false);
		const next = rememberChainId({storage, key: 'w', random: () => 0.75});
		expect(next).not.toBe(first);
	});

	it('sweeps what is keyed by the old id, and nothing else', () => {
		const storage = listableStorage();
		const id = rememberChainId({storage, key: 'w', random: () => 0.5});
		const other = id - 1;
		storage.setItem(`embedded-wallet:${id}:mnemonic`, 'words');
		storage.setItem(`embedded:${id}:last-wallet`, 'x');
		storage.setItem(`__private__${id}_0xgenesis_0xscope_0xme`, '{}');
		storage.setItem(`__in_flight_requests__${id}_0xgenesis`, '[]');
		// Another world's, and one whose number merely CONTAINS the id's digits.
		storage.setItem(`embedded:${other}:last-wallet`, 'y');
		storage.setItem(`embedded:${id}7:last-wallet`, 'z');
		// The app's own.
		storage.setItem('settings', '{"theme":"dark"}');

		forgetChainId({storage, key: 'w'});

		expect([...storage.map.keys()].sort()).toEqual(
			[
				`embedded:${other}:last-wallet`,
				`embedded:${id}7:last-wallet`,
				'settings',
			].sort(),
		);
	});

	it('forgets a storage it cannot list by its key alone', () => {
		const map = new Map<string, string>();
		const storage = {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v),
			removeItem: (k: string) => void map.delete(k),
		};
		const id = rememberChainId({storage, key: 'w', random: () => 0.5});
		map.set(`embedded:${id}:x`, 'kept');
		expect(forgetChainId({storage, key: 'w'})).toBe(id);
		expect([...map.keys()]).toEqual([`embedded:${id}:x`]);
	});

	it('has nothing to sweep when there was no world, or one it could not have minted', () => {
		const empty = listableStorage({settings: '1'});
		expect(forgetChainId({storage: empty, key: 'w'})).toBeUndefined();
		const odd = listableStorage({w: '31337', 'embedded:31337:x': 'kept'});
		expect(forgetChainId({storage: odd, key: 'w'})).toBeUndefined();
		expect(odd.map.has('w')).toBe(false);
		expect(odd.map.has('embedded:31337:x')).toBe(true);
	});
});
