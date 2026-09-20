import {writable, get as getStore} from 'svelte/store';
import type {DeploymentsStore, TypedDeployments} from '$lib/deployments-store';
import buildTimeDeployments from '$lib/deployments';

/**
 * THE DEPLOYMENT RECORDS OF THE WORLD IN THE TAB, as a `DeploymentsStore`.
 *
 * `deployments` is a member of `EstablishedConnection` for exactly this
 * reason: a second world has its own contracts at its own addresses, so a
 * factory handing back the app's build-time records for somebody else's chain
 * would be lying about both.
 *
 * WHY THIS CANNOT BE DEFERRED, which is the load-bearing fact about the whole
 * layer and the answer to "can a world's context exist before its chain does".
 * The PROVIDER can be deferred - `@etherplay/connect` only ever calls
 * `endpoint.request(...)`, lazily, so a provider that queues until the node
 * exists works. The DEPLOYMENTS cannot: `DeploymentsStore.get()` is
 * synchronous by contract and `createContext` reads a contract ADDRESS out of
 * it while it is constructing (`operationScopeAddress`, which scopes the
 * operations ledger). There is no address to answer with before the deploy has
 * run, and inventing one would key a player's history to a contract that does
 * not exist.
 *
 * So an embedded world is BUILT asynchronously and its context is constructed
 * synchronously afterwards, rather than the context being constructed first
 * and filled in. ADR-0002 is untouched: the app-level context is still built
 * synchronously during prerender, because it is the REMOTE world; only a page
 * that offers an embedded one waits, in the browser, where waiting is allowed.
 */

/**
 * The contract names this app was BUILT against.
 *
 * Read off the generated file rather than listed here, so it cannot drift from
 * what the app's own code expects to find.
 */
export function expectedContractNames(): string[] {
	return Object.keys(
		(buildTimeDeployments as unknown as {contracts: Record<string, unknown>})
			.contracts,
	);
}

export type EmbeddedChainMetadata = {
	name: string;
	nativeCurrency?: {name: string; symbol: string; decimals: number};
	properties?: Record<string, unknown>;
};

export type DeployedContractRecord = {
	address: `0x${string}`;
	abi: readonly unknown[];
	linkedData?: unknown;
	[key: string]: unknown;
};

/**
 * Build the store the world hands to the context.
 *
 * IT CHECKS THE RECORDS AGAINST WHAT THE APP EXPECTS, and that check is the
 * point rather than defensiveness. The cast at the end is unavoidable - the
 * build-time type names each contract and its ABI literally, and records
 * produced at runtime cannot carry a literal type - so the type system stops
 * saying anything here and something else has to. A missing contract is a
 * deploy script the world forgot to run, and without this it surfaces as
 * `Cannot read properties of undefined` somewhere far away, in a tab, after
 * the player has started a game.
 */
export function createEmbeddedDeployments(params: {
	chainId: number;
	chain: EmbeddedChainMetadata;
	/** The environment name the deploy ran under. */
	name: string;
	contracts: Record<string, DeployedContractRecord>;
	/** Which names must be present. Defaults to what this app was built against. */
	expected?: string[];
}): DeploymentsStore {
	const {chainId, chain, name, contracts} = params;
	const expected = params.expected ?? expectedContractNames();

	const missing = expected.filter((contractName) => !contracts[contractName]);
	if (missing.length > 0) {
		throw new Error(
			`the embedded world deployed ${Object.keys(contracts).length} contracts ` +
				`and this app needs ${missing.join(', ')}: ` +
				`the world is missing a deploy script, or its tags excluded one.`,
		);
	}

	const value = {
		chain: {
			id: chainId,
			name: chain.name,
			nativeCurrency: chain.nativeCurrency ?? {
				name: 'Ether',
				symbol: 'ETH',
				decimals: 18,
			},
			// EMPTY ON PURPOSE, and it is a supported state rather than a hole: an
			// embedded chain has no URL, and the app reaches it through the
			// provider the world supplies. `hasConfiguredRpc` reads this list to
			// decide whether the app can read the chain without a wallet, and the
			// answer for a world whose provider IS the chain is that it can - see
			// `world.ts`, which is why the chain info handed to the connection
			// carries `provider`.
			rpcUrls: {default: {http: [] as string[]}},
			properties: chain.properties ?? {},
		},
		contracts,
		name,
	};

	const store = writable(value as unknown as TypedDeployments);
	return {
		subscribe: store.subscribe,
		get: () => getStore(store),
	};
}
