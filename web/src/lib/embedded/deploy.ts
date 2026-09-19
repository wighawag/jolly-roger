import {setupEnvironment, createVFSDeploymentStore} from '@rocketh/web';
import type {DeployScript, EIP1193ProviderLike, RockethSetup} from './types.js';

/**
 * RUN THE GAME'S OWN DEPLOY SCRIPTS, in the tab, against the chain in the tab.
 *
 * The alternative was to bake a state dump at build time and load it. Running
 * the real scripts wins for a reason that is about this repo rather than about
 * purity: a baked dump is a GENERATED, gitignored artifact that has to be
 * rebuilt after every contract change and goes stale in silence, which is the
 * exact hazard the generated `deployments.ts` keeps firing here. The scripts
 * cannot go stale, because they are the same ones the real deployment runs.
 *
 * MEASURED, node, 2026-09-19, against this template's own contracts and against
 * template-commit-reveal's (a token, a routed proxy with four routes, and a
 * sale): boot 4-12ms, the whole deploy 89-101ms. So the cost is not the reason
 * to choose either way, which is worth saying because the plan expected it to
 * be.
 *
 * WHAT HAD TO BE LEARNED, both of which are one line and neither of which is
 * documented anywhere:
 *
 * - `autoMine` MUST be false. It is rocketh's "mine after sending" for a node
 *   that needs telling, and it calls `evm_mine`, which webevm answers with a
 *   real `-32601`. There is nothing to ask for: automine has already mined the
 *   block by the time the send returns.
 * - The named accounts cannot be INDEXES. `{deployer: {default: 0}}` means
 *   "the provider's account 0", and an execution-only node has no accounts at
 *   all. They come in as private keys through the `privateKey` signer protocol,
 *   which the app's rocketh config already registers.
 */
export type DeployWorldParams = {
	provider: EIP1193ProviderLike;
	/** The app's own `{config, extensions}`, exactly as its node deploys use. */
	rocketh: RockethSetup;
	scripts: DeployScript[];
	/** The minted id (see `chain-id.ts`). */
	chainId: number;
	/**
	 * The environment NAME the deploy runs under. It selects the deploy's
	 * per-network `data`, so it is what decides the cycle policy, the phase
	 * durations and every other figure the deployment declares. A world names
	 * its own rather than borrowing `localhost`, so that changing what an
	 * offline game is does not change what a developer's local chain is.
	 */
	environment: string;
	/** Named account -> private key. Every account the scripts name needs one. */
	accounts: Record<string, `0x${string}`>;
	/**
	 * Per-environment deploy data for this world, merged into the app's config
	 * under `environment`. This is where a game says what its OFFLINE deployment
	 * is - for a commit-reveal game, the manual cycle policy and zero phase
	 * durations.
	 */
	data?: Record<string, unknown>;
	/** Chain properties for the minted id (gas price expectations and the like). */
	chainProperties?: Record<string, unknown>;
	/** Where the records go. Defaults to an in-memory store, which does not survive a reload. */
	deploymentStore?: Parameters<typeof setupEnvironment>[2] extends
		{deploymentStore?: infer S} | undefined
		? S
		: never;
};

export type DeployedWorld = {
	/** The rocketh environment, so a provisioning hook can execute against it. */
	env: Awaited<
		ReturnType<
			ReturnType<
				typeof setupEnvironment
			>['loadAndExecuteDeploymentsFromModules']
		>
	>;
};

/**
 * Compose the config the deploy runs under: the app's, plus this world.
 *
 * Exported and pure so it can be asserted directly. What it adds is the whole
 * difference between a node deploy and a tab deploy, and every clause of it has
 * a reason:
 *
 * - `accounts` are replaced rather than merged, because an index-based entry
 *   the caller forgot is not a missing key, it is a `-32601` half way through a
 *   deploy.
 * - the `environment` entry names the MINTED chain id, so the records are filed
 *   under this world rather than under 31337.
 * - `chains[chainId].properties` is what the client reads back for gas pricing.
 *   Without it the app falls back to `defaultChainProperties`, which is a real
 *   answer and usually the wrong one for a chain where gas is free.
 */
export function composeWorldConfig(params: {
	config: Record<string, unknown>;
	chainId: number;
	environment: string;
	accounts: Record<string, `0x${string}`>;
	data?: Record<string, unknown>;
	chainProperties?: Record<string, unknown>;
}): Record<string, unknown> {
	const {config, chainId, environment, accounts, data, chainProperties} =
		params;

	const namedAccounts: Record<string, {default: string}> = {};
	for (const [name, key] of Object.entries(accounts)) {
		namedAccounts[name] = {default: `privateKey:${key}`};
	}

	const existingChains = (config.chains as Record<string, unknown>) ?? {};
	const existingData = (config.data as Record<string, unknown>) ?? {};
	const existingEnvironments =
		(config.environments as Record<string, unknown>) ?? {};

	// Per-KEY merge, not a replace: `data` in a rocketh config is
	// `{[key]: {[environment]: value}}`, so a world declaring `Game` must not
	// erase the entries for everything else the deploy reads.
	const mergedData: Record<string, unknown> = {...existingData};
	for (const [key, value] of Object.entries(data ?? {})) {
		mergedData[key] = {
			...((existingData[key] as Record<string, unknown>) ?? {}),
			[environment]: value,
		};
	}

	return {
		...config,
		accounts: namedAccounts,
		chains: {
			...existingChains,
			[chainId]: {
				...((existingChains[String(chainId)] as Record<string, unknown>) ?? {}),
				...(chainProperties ? {properties: chainProperties} : {}),
				tags: ['local', 'memory', 'embedded'],
			},
		},
		environments: {
			...existingEnvironments,
			[environment]: {chain: chainId},
		},
		data: mergedData,
	};
}

export async function deployWorldContracts(
	params: DeployWorldParams,
): Promise<DeployedWorld> {
	const {
		provider,
		rocketh,
		scripts,
		chainId,
		environment,
		accounts,
		data,
		chainProperties,
		deploymentStore,
	} = params;

	const worldConfig = composeWorldConfig({
		config: rocketh.config,
		chainId,
		environment,
		accounts,
		data,
		chainProperties,
	});

	const {loadAndExecuteDeploymentsFromModules} = setupEnvironment(
		worldConfig as never,
		rocketh.extensions as never,
		{deploymentStore: (deploymentStore ?? createVFSDeploymentStore()) as never},
	);

	const env = await loadAndExecuteDeploymentsFromModules(scripts as never, {
		environment,
		provider: provider as never,
		saveDeployments: true,
		askBeforeProceeding: false,
		// See the module comment: webevm has already mined.
		autoMine: false,
	});

	return {env: env as DeployedWorld['env']};
}
