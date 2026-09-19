import {describe, it, expect} from 'vitest';
import {get} from 'svelte/store';
import {
	createEmbeddedDeployments,
	expectedContractNames,
} from '$lib/embedded/deployments';

const record = (address: `0x${string}`) => ({address, abi: [] as const});

describe('the deployment records of the world in the tab', () => {
	it('refuses to hand back a world missing a contract this app needs', () => {
		// The cast at the end of the builder is unavoidable (a runtime record
		// cannot carry the build-time literal type), so the type system stops
		// saying anything and this has to. Without it, a deploy script the world
		// forgot surfaces as `Cannot read properties of undefined`, in a tab,
		// after the player has started a game.
		expect(() =>
			createEmbeddedDeployments({
				chainId: 9007199254740000,
				chain: {name: 'Embedded'},
				name: 'embedded',
				contracts: {},
				expected: ['GreetingsRegistry'],
			}),
		).toThrow(/GreetingsRegistry/);
	});

	it('carries the minted chain id and the records it was given', () => {
		const contracts = {
			GreetingsRegistry: record('0x0000000000000000000000000000000000000001'),
		};
		const store = createEmbeddedDeployments({
			chainId: 9007199254740000,
			chain: {name: 'Embedded', properties: {averageBlockTimeMs: 1}},
			name: 'embedded',
			contracts,
			expected: ['GreetingsRegistry'],
		});
		expect(store.get().chain.id).toBe(9007199254740000);
		expect(store.get().contracts.GreetingsRegistry.address).toBe(
			'0x0000000000000000000000000000000000000001',
		);
		// and it is a real store, because the context subscribes to it
		expect(get(store).name).toBe('embedded');
	});

	it('has no rpc url, which is a supported state and not a hole', () => {
		const store = createEmbeddedDeployments({
			chainId: 9007199254740000,
			chain: {name: 'Embedded'},
			name: 'embedded',
			contracts: {
				GreetingsRegistry: record('0x0000000000000000000000000000000000000001'),
			},
			expected: [],
		});
		expect(store.get().chain.rpcUrls.default.http).toEqual([]);
	});

	it('knows what this app was built against, rather than being told', () => {
		// Read off the generated file so the expectation cannot drift from what
		// the app's own code looks for.
		expect(expectedContractNames().length).toBeGreaterThan(0);
	});
});
