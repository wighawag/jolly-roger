import type {AugmentedChainInfo} from '$lib/core/connection/types.js';
import type {TypedDeployments} from '$lib/deployments-store.js';

// ============================================================================
// Default configuration values
// ============================================================================

/** Default finality (confirmations) for chains without explicit configuration (Ethereum mainnet default). */
const DEFAULT_FINALITY = 12;

/** Default block time in ms for chains without explicit configuration (Ethereum mainnet ~12s). */
const DEFAULT_BLOCK_TIME_MS = 12000;

/** Minimum tx-observer process interval, to avoid excessive polling. */
const MIN_PROCESS_INTERVAL_MS = 1000;

/** Default number of messages to display. */
const DEFAULT_MAX_MESSAGES = 10;

/**
 * tx-observer process interval derived from block time: half the block time,
 * clamped to a minimum threshold.
 */
function processIntervalFromBlockTime(blockTimeMs: number): number {
	return Math.max(Math.floor(blockTimeMs / 2), MIN_PROCESS_INTERVAL_MS);
}

/**
 * The effective app configuration, resolved from chain properties + defaults.
 */
export type ResolvedAppConfig = {
	/** Confirmations before a transaction is considered final. */
	finality: number;
	/** Average block time in ms. */
	blockTimeMs: number;
	/** How often the tx-observer processes, in ms (derived from block time). */
	txObserverProcessInterval: number;
	/** Max messages to display / load. */
	maxMessages: number;
};

/**
 * Resolve the app configuration for a given chain: reads the chain's optional
 * `properties` (finality, averageBlockTimeMs) and fills in defaults, deriving
 * the tx-observer interval. Pure: chain in, config out.
 */
export function resolveAppConfig(chain: AugmentedChainInfo): ResolvedAppConfig {
	const properties = chain.properties ?? {};
	const finality = properties.finality ?? DEFAULT_FINALITY;
	const blockTimeMs = properties.averageBlockTimeMs ?? DEFAULT_BLOCK_TIME_MS;
	return {
		finality,
		blockTimeMs,
		txObserverProcessInterval: processIntervalFromBlockTime(blockTimeMs),
		maxMessages: DEFAULT_MAX_MESSAGES,
	};
}

/**
 * The address that scopes local operation data.
 *
 * Local operations belong to a specific deployment, so the storage key
 * includes one contract's address. Which contract is app-specific: this is
 * the single place a descendant changes it, and since the deployments object
 * is typed, renaming the contract or removing it is a compile error.
 *
 * The contract should be one whose address is stable for the deployment's
 * lifetime (e.g. the main proxy), not its implementation, which changes on
 * every hot contract replacement.
 */
export function operationScopeAddress(
	deployments: TypedDeployments,
): `0x${string}` {
	return deployments.contracts.GreetingsRegistry.address;
}
