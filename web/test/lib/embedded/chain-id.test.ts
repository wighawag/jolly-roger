import {describe, it, expect} from 'vitest';
import {
	mintChainId,
	rememberChainId,
	isEmbeddedChainId,
	MIN_EMBEDDED_CHAIN_ID,
	MAX_EMBEDDED_CHAIN_ID,
	MAX_CHAIN_ID,
} from '$lib/embedded/chain-id';

function fakeStorage(initial?: Record<string, string>) {
	const map = new Map(Object.entries(initial ?? {}));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		map,
	};
}

describe('minting a chain id for an embedded world', () => {
	it('never mints above the id a JSON number can carry', () => {
		// EIP-2294's ceiling. Above it a round trip through JSON.parse rounds,
		// and two worlds can silently become one.
		expect(mintChainId(() => 0.999999999)).toBeLessThanOrEqual(MAX_CHAIN_ID);
		expect(mintChainId(() => 1)).toBeLessThanOrEqual(MAX_CHAIN_ID);
		expect(Number.isSafeInteger(mintChainId(() => 1))).toBe(true);
	});

	it('mints clear of the dev conventions and of every registered chain', () => {
		// 31337 and 1337 are what an embedded chain is tempted to call itself,
		// and the highest id anyone has registered is ~2.7e15 (chainid.network,
		// 2026-09-19). The range starts three orders of magnitude above it.
		expect(MIN_EMBEDDED_CHAIN_ID).toBeGreaterThan(2_716_446_429_837_001);
		expect(isEmbeddedChainId(31337)).toBe(false);
		expect(isEmbeddedChainId(1337)).toBe(false);
		expect(isEmbeddedChainId(mintChainId(() => 0))).toBe(true);
		expect(isEmbeddedChainId(mintChainId(() => 0.5))).toBe(true);
	});

	it('gives two worlds two ids', () => {
		const a = mintChainId(() => 0.1);
		const b = mintChainId(() => 0.7);
		expect(a).not.toBe(b);
	});

	it('remembers the one it minted, because the id is what keys the saves', () => {
		const storage = fakeStorage();
		const first = rememberChainId({storage, key: 'w', random: () => 0.25});
		const again = rememberChainId({storage, key: 'w', random: () => 0.9});
		expect(again).toBe(first);
		expect(storage.map.get('w')).toBe(String(first));
	});

	it('replaces a stored id it could not have minted', () => {
		// Corrupt, or from a build with a different range. Carrying it forward
		// would key a world by something this code cannot reason about.
		const storage = fakeStorage({w: '31337'});
		const id = rememberChainId({storage, key: 'w', random: () => 0.25});
		expect(isEmbeddedChainId(id)).toBe(true);
		expect(id).not.toBe(31337);
	});

	it('keeps two worlds apart by key', () => {
		const storage = fakeStorage();
		const a = rememberChainId({storage, key: 'a', random: () => 0.1});
		const b = rememberChainId({storage, key: 'b', random: () => 0.8});
		expect(a).not.toBe(b);
		expect(isEmbeddedChainId(a) && isEmbeddedChainId(b)).toBe(true);
		expect(MAX_EMBEDDED_CHAIN_ID - MIN_EMBEDDED_CHAIN_ID).toBe(0x100000);
	});
});
