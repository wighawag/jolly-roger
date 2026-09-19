/**
 * The little that this layer needs to NAME rather than import.
 */

/** What everything here passes around as "the chain": one async method. */
export type EIP1193ProviderLike = {
	request(args: {method: string; params?: unknown}): Promise<unknown>;
};

/**
 * One rocketh deploy script, as `@rocketh/web` takes it.
 *
 * `module` is the script's default export. Typed loosely on purpose: the
 * scripts belong to the GAME, they are compiled from that package's own
 * sources, and this layer only carries them from the app to rocketh. Naming
 * rocketh's generic `ModuleObject` here would make every app's deploy script
 * satisfy a type parameterised by that app's own named accounts and data,
 * which is a type the framework cannot write.
 */
export type DeployScript = {
	id: string;
	module: unknown;
};

/**
 * A rocketh setup, as the deploying app supplies it: what it exports from its
 * own `rocketh/config` (or `rocketh/deploy`).
 */
export type RockethSetup = {
	config: Record<string, unknown>;
	extensions: Record<string, unknown>;
};
