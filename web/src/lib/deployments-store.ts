import {writable} from 'svelte/store';
import type {Readable} from 'svelte/store';
import initialDeployments from '$lib/deployments';

// ============================================================================
// Types - Centralized here to avoid HMR cascade from type changes
// ============================================================================

/**
 * The deployment data structure - derived from the static import
 */
export type TypedDeployments = typeof initialDeployments;

/**
 * Chain type derived from deployments.
 *
 * A plain alias now. This used to re-widen `rpcUrls.default.http` by hand,
 * because the generated file is emitted `as const` and its rpc list is usually
 * empty, which pinned the type to `readonly []` - a type nothing is assignable
 * to, so no code could inject an RPC url at runtime (see
 * establishRemoteConnection's chainInfoNodeURL override). @rocketh/export now
 * widens `rpcUrls` and `properties` at the source, leaving the literal types on
 * addresses and ABIs untouched, so the cast has nothing left to correct.
 */
export type ChainInfo = TypedDeployments['chain'];

/**
 * JSON-compatible value types for chain properties
 */
export type JSONValue =
	string | number | boolean | null | JSONValue[] | {[key: string]: JSONValue};

/**
 * Known chain properties that can be specified in deployments.
 */
export type KnownChainProperties = {
	averageBlockTimeMs?: number;
	finality?: number;
};

/**
 * Block explorer configuration following viem's Chain format
 */
export type BlockExplorerConfig = {
	name: string;
	url: string;
	apiUrl?: string;
};

/**
 * Block explorers map with default and additional named explorers
 */
export type BlockExplorers = {
	default?: BlockExplorerConfig;
	[key: string]: BlockExplorerConfig | undefined;
};

/**
 * Augments a chain type with the properties this app knows how to read.
 *
 * Still needed after the exporter's own widening, which stops at
 * `Record<string, JSONValue>`: that makes `properties` readable but says
 * nothing about what any given key MEANS. Intersecting KnownChainProperties is
 * what makes `finality` a number rather than a JSONValue at the two call sites
 * that resolve app config. `blockExplorers` is added for the same reason: it is
 * optional chain metadata the exporter does not model.
 */
export type AugmentedChain<T> = T & {
	properties?: Record<string, JSONValue> & KnownChainProperties;
	blockExplorers?: BlockExplorers;
};

/**
 * Augmented chain info with optional properties
 */
export type AugmentedChainInfo = AugmentedChain<ChainInfo>;

/**
 * Augmented deployment type with proper chain typing.
 */
export type AugmentedDeployments<T extends {chain: unknown}> = Omit<
	T,
	'chain'
> & {
	chain: AugmentedChain<T['chain']>;
};

/**
 * Augmented deployments with access to optional chain properties
 */
export type TypedAugmentedDeployments = AugmentedDeployments<TypedDeployments>;

/**
 * Deployments store interface - Svelte readable with synchronous access
 */
export type DeploymentsStore = Readable<TypedDeployments> & {
	/** Synchronous access to current deployments value */
	get(): TypedDeployments;
};

// ============================================================================
// Store Implementation
// ============================================================================

// Track current deployments for synchronous access
let currentDeployments: TypedDeployments = initialDeployments;

// The writable store holding current deployments
const deploymentsWritable = writable<TypedDeployments>(initialDeployments);

// Update the current value whenever store changes
deploymentsWritable.subscribe((value) => {
	currentDeployments = value;
});

/**
 * The deployments store - reactive with synchronous access via .get()
 *
 * Usage in Svelte components:
 *   $deployments.chain.id  // reactive
 *
 * Usage in non-reactive contexts:
 *   deployments.get().chain.id  // synchronous
 */
export const deployments: DeploymentsStore = {
	subscribe: deploymentsWritable.subscribe,
	get() {
		return currentDeployments;
	},
};

// ============================================================================
// HMR Handling
// ============================================================================

/**
 * Conditions that require a full page reload instead of HMR update.
 * Can be extended with additional checks as needed.
 */
function requiresFullReload(
	oldDeployments: TypedDeployments,
	newDeployments: TypedDeployments,
): boolean {
	// Chain ID change requires full reload - fundamental app state change
	if (oldDeployments.chain.id !== newDeployments.chain.id) {
		console.log('[HMR] Chain ID changed, triggering full reload');
		return true;
	}

	// Genesis hash change means different chain
	if (oldDeployments.chain.genesisHash !== newDeployments.chain.genesisHash) {
		console.log('[HMR] Genesis hash changed, triggering full reload');
		return true;
	}

	// Add more conditions here as needed:
	// - Contract address changes for critical contracts
	// - RPC URL changes
	// etc.

	return false;
}

if (import.meta.hot) {
	// Accept updates to the deployments.ts file
	import.meta.hot.accept('$lib/deployments', (newModule) => {
		if (newModule?.default) {
			const newDeployments = newModule.default as TypedDeployments;

			// Check if we need a full page reload
			if (requiresFullReload(currentDeployments, newDeployments)) {
				// Use explicit browser reload for critical changes
				// HMR bubble-up doesn't work reliably due to Svelte components
				// accepting HMR updates automatically
				console.log('[HMR] Critical change detected, reloading page...');
				location.reload();
				return;
			}

			console.log('[HMR] Deployments updated reactively');
			deploymentsWritable.set(newDeployments);
		}
	});

	// Accept self-updates for non-critical changes to store logic
	import.meta.hot.accept();
}
