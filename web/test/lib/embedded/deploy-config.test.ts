import {describe, it, expect} from 'vitest';
import {composeWorldConfig} from '$lib/embedded/deploy';

const appConfig = {
	accounts: {deployer: {default: 0}, admin: {default: 0}},
	chains: {
		31337: {properties: {expectedWorstGasPrice: 1n}, tags: ['local']},
	},
	environments: {localhost: {chain: 31337}},
	data: {
		Game: {localhost: {cyclePolicy: 0n}, default: {cyclePolicy: 0n}},
		sale: {default: {price: 5n}},
	},
	signerProtocols: {},
};

const KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

describe('the config an in-tab deploy runs under', () => {
	it('replaces index accounts with keys, because the node has no accounts', () => {
		// `{default: 0}` means "the provider's account 0" and webevm answers
		// eth_accounts with a real -32601. A leftover index is not a missing
		// key, it is a -32601 half way through a deploy.
		const composed = composeWorldConfig({
			config: appConfig,
			chainId: 9007199254740000,
			environment: 'embedded',
			accounts: {deployer: KEY, admin: KEY},
		});
		expect(composed.accounts).toEqual({
			deployer: {default: `privateKey:${KEY}`},
			admin: {default: `privateKey:${KEY}`},
		});
	});

	it('files the deployment under the world, not under 31337', () => {
		const composed = composeWorldConfig({
			config: appConfig,
			chainId: 9007199254740000,
			environment: 'embedded',
			accounts: {deployer: KEY},
		});
		expect(
			(composed.environments as Record<string, {chain: number}>).embedded,
		).toEqual({chain: 9007199254740000});
		// and leaves the app's own environments alone
		expect(
			(composed.environments as Record<string, {chain: number}>).localhost,
		).toEqual({chain: 31337});
	});

	it('merges deploy data per key, so a world declaring one does not erase the others', () => {
		// This is where a game says what its OFFLINE deployment is - for a
		// commit-reveal game, the manual cycle policy and zero phase durations.
		const composed = composeWorldConfig({
			config: appConfig,
			chainId: 9007199254740000,
			environment: 'embedded',
			accounts: {deployer: KEY},
			data: {Game: {cyclePolicy: 1n, commitPhaseDuration: 0n}},
		});
		const data = composed.data as Record<string, Record<string, unknown>>;
		expect(data.Game.embedded).toEqual({
			cyclePolicy: 1n,
			commitPhaseDuration: 0n,
		});
		// the app's own entries survive, and so does every other key
		expect(data.Game.localhost).toEqual({cyclePolicy: 0n});
		expect(data.sale).toEqual({default: {price: 5n}});
	});

	it('declares chain properties for the minted id', () => {
		// Without them the deploy falls back to `defaultChainProperties`, which
		// is a real answer and the wrong one for a chain where gas is free.
		const composed = composeWorldConfig({
			config: appConfig,
			chainId: 9007199254740000,
			environment: 'embedded',
			accounts: {deployer: KEY},
			chainProperties: {expectedWorstGasPrice: 0n},
		});
		const chains = composed.chains as Record<
			string,
			{properties?: unknown; tags?: string[]}
		>;
		expect(chains['9007199254740000'].properties).toEqual({
			expectedWorstGasPrice: 0n,
		});
		expect(chains['9007199254740000'].tags).toContain('embedded');
		expect(chains['31337']).toBeDefined();
	});
});
