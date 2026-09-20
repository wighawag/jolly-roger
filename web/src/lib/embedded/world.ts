import {establishConnectionOn} from '$lib/core/connection/remote';
import type {ConnectionFactory} from '$lib/context/index';
import type {DeploymentsStore} from '$lib/deployments-store';
import {startEmbeddedNode, type StartEmbeddedNodeParams} from './node.js';
import {deployWorldContracts} from './deploy.js';
import {
	createEmbeddedDeployments,
	type DeployedContractRecord,
	type EmbeddedChainMetadata,
} from './deployments.js';
import type {DeployScript, EIP1193ProviderLike, RockethSetup} from './types.js';

/**
 * A WORLD: a chain, the contracts on it, and the records that say where they
 * are.
 *
 * `establishConnection` is the point of the whole file. It is a
 * `ConnectionFactory`, the parameter `createContext` has taken since
 * 2026-09-18, and until now its only caller was the test that pins it. A world
 * gets a CONTEXT and an identity gets a CONNECTION: everything that describes
 * where the player is - the chain, both clients, the deployment records, the
 * account history keyed by chain - follows the world, and the one thing that
 * does NOT is how the app authenticates. The factory is handed the request and
 * passes it through, so `TARGET_STEP` stays the single line deciding whether
 * there is a signer, on every world the app can offer.
 */
export type EmbeddedWorld = {
	chainId: number;
	provider: EIP1193ProviderLike;
	deployments: DeploymentsStore;
	establishConnection: ConnectionFactory;
	/** The rocketh environment the deploy produced. What provisioning acts on. */
	env: Awaited<ReturnType<typeof deployWorldContracts>>['env'];
	dispose(): Promise<void>;
};

/**
 * WHO IS GIVEN WHAT, BEFORE THE GAME STARTS - and it is a hook rather than a
 * list because the answer is never the framework's.
 *
 * An offline player needs gas, and every game beyond the simplest needs more:
 * this template's reference game needs an ERC20 stake bonded at commit time,
 * an NFT-identity game needs a token it owns, another game needs a starting
 * position. Written into the world per branch, that list lands in the ALLOWED
 * divergence tables of every branch that has it and is maintained in four
 * places. Written as a hook, the world supplies the chain and the game
 * supplies the meaning, and a branch adds a FILE rather than editing a shared
 * one.
 *
 * It runs AFTER the deploy and BEFORE the context exists, which is the only
 * moment at which "the player has everything they need to play" is a single
 * fact rather than a sequence of flows the offline player has no reason to
 * walk through.
 */
export type ProvisionParams = {
	env: EmbeddedWorld['env'];
	node: Awaited<ReturnType<typeof startEmbeddedNode>>;
	/** Handed straight through from the spec, so a game can address its player. */
	accounts: Record<string, `0x${string}`>;
};

/**
 * IS A RESTORED WORLD STILL A WORLD?
 *
 * A world persists in THREE places and they can be restored to different
 * points: the chain (webevm's IndexedDB dump), the deployment records
 * (`@rocketh/web`'s store) and the player's own submissions or operations
 * (localStorage, keyed by chain id). Nothing makes them atomic.
 *
 * Records that outlive their chain are the dangerous shape, and the danger is
 * not subtle: rocketh SKIPS a deploy it believes it has already done, so the
 * deploy script runs against an address with no code at it. Measured: the
 * boot does not limp, it THROWS - jolly-roger's own script reads the contract
 * it just "deployed", gets `0x` back and fails to decode it. A world that
 * checked afterwards would never reach the check.
 *
 * So the question is asked BEFORE anything is deployed, and it is asked of
 * the cheapest pair of facts that can disagree: the store holds records, and
 * the chain has no blocks beyond genesis. A caller that gets `false` should
 * start a new world under a NEW chain id rather than repairing this one, so
 * that storage keyed by the old id is orphaned instead of being mixed into a
 * world it does not describe.
 */
export async function restoreIsCoherent(params: {
	provider: EIP1193ProviderLike;
	/** The deployment store's file system. Empty means nothing was restored. */
	vfs: {paths(): string[]};
}): Promise<boolean> {
	const records = params.vfs.paths().length > 0;
	const blockNumber = Number(
		BigInt(
			(await params.provider.request({method: 'eth_blockNumber'})) as string,
		),
	);
	const chain = blockNumber > 0;
	// Both empty is a first run, both present is a restore, and one without the
	// other is the case this exists for. Note which way round it matters: a
	// chain with no records would simply be deployed onto again, wasting a few
	// blocks; records with no chain is the one that throws.
	return records === chain;
}

export type EmbeddedWorldSpec = {
	chainId: number;
	/** How the chain describes itself to the app and to a wallet. */
	chain: EmbeddedChainMetadata;
	rocketh: RockethSetup;
	scripts: DeployScript[];
	/**
	 * Named account -> private key, for the deploy AND for anyone the
	 * provisioning hook acts as. NOT the player's wallet: the player signs with
	 * the wallet the app already announces (see the README on why a burner is
	 * the right shape here and the local signer is inapplicable).
	 */
	accounts: Record<string, `0x${string}`>;
	/** The deploy's environment name. Defaults to `embedded`. */
	environment?: string;
	/** Per-key deploy data for this world. See `deploy.ts`. */
	data?: Record<string, unknown>;
	initialBalances?: StartEmbeddedNodeParams['initialBalances'];
	persistence?: StartEmbeddedNodeParams['persistence'];
	blockGasLimit?: StartEmbeddedNodeParams['blockGasLimit'];
	createNode?: StartEmbeddedNodeParams['createNode'];
	deploymentStore?: Parameters<
		typeof deployWorldContracts
	>[0]['deploymentStore'];
	/** Which contracts must exist afterwards. Defaults to the app's own set. */
	expectedContracts?: string[];
	provision?: (params: ProvisionParams) => Promise<ProvisionResult>;
	/**
	 * The wallet this world plays with, if it is known before provisioning.
	 *
	 * Usually it is NOT: the wallet is created by `provision`, which is the
	 * hook that gives the player everything they need, and a wallet is one of
	 * those things. So the ordinary route is to return it from there.
	 */
	wallets?: EmbeddedWallets;
};

/**
 * WHAT PROVISIONING MAY HAND BACK.
 *
 * `void` is the common case. A hook that creates the player's WALLET returns
 * it, because the world needs it strictly later than the hook runs (the
 * connection is built last, after the deploy) and strictly after the hook
 * decides it. Passing it in on the spec cannot work: the wallet does not exist
 * when the spec is written.
 */
export type ProvisionResult = void | {wallets?: EmbeddedWallets};

export type EmbeddedWallets = NonNullable<
	Parameters<typeof establishConnectionOn>[0]['wallets']
>;

/**
 * Boot a chain, deploy onto it, provision the player, and hand back a world.
 *
 * ASYNC, AND THE CONTEXT IT FEEDS IS NOT. See `deployments.ts`: the provider
 * could be deferred, the deployment records cannot, so the order is build the
 * world, then construct a context around it. That keeps ADR-0002 exactly as it
 * is - the app-level context is still synchronous and SSR-inert, because it is
 * the remote world - and confines the waiting to a browser-only page that has
 * something to say while it waits.
 *
 * MEASURED, in node: 4-12ms to boot the chain, 89-101ms to run a real deploy
 * (this template's, and template-commit-reveal's routed proxy with four routes
 * and a sale). At that cost either lifetime is affordable, so the lifetime is
 * decided by what a world IS rather than by what it costs: it is STATE, not a
 * view, so it is created once and outlives any route that shows it. Creating
 * one per navigation would throw the player's chain away when they visited
 * another page.
 */
export async function createEmbeddedWorld(
	spec: EmbeddedWorldSpec,
): Promise<EmbeddedWorld> {
	const environment = spec.environment ?? 'embedded';

	const node = await startEmbeddedNode({
		chainId: spec.chainId,
		initialBalances: spec.initialBalances,
		persistence: spec.persistence,
		blockGasLimit: spec.blockGasLimit,
		createNode: spec.createNode,
	});

	const {env} = await deployWorldContracts({
		provider: node.provider,
		rocketh: spec.rocketh,
		scripts: spec.scripts,
		chainId: spec.chainId,
		environment,
		accounts: spec.accounts,
		data: spec.data,
		chainProperties: spec.chain.properties,
		deploymentStore: spec.deploymentStore,
	});

	let wallets = spec.wallets;
	if (spec.provision) {
		const provisioned = await spec.provision({
			env,
			node,
			accounts: spec.accounts,
		});
		wallets = provisioned?.wallets ?? wallets;
	}

	const deployments = createEmbeddedDeployments({
		chainId: spec.chainId,
		chain: spec.chain,
		name: environment,
		contracts: (
			env as unknown as {deployments: Record<string, DeployedContractRecord>}
		).deployments,
		expected: spec.expectedContracts,
	});

	const establishConnection: ConnectionFactory = (request) =>
		establishConnectionOn({
			// One wallet, one account, nothing to pick. A world that brings its
			// own wallet did not inherit the player's choice, it made one.
			wallets,
			useCurrentAccount: wallets ? 'always' : undefined,
			// ITS OWN SLOT, AND THIS IS NOT TIDINESS. Every connection persists
			// "the wallet I last used" and "the account I was", and two that
			// share one slot become each other on the next load: the app's own
			// connection auto-reconnects as the world's generated wallet, on an
			// account no installed wallet holds, and then asks the user to
			// switch to a chain id that exists only in this tab. Observed
			// exactly that way - an account in the navbar, a switch-network
			// modal, and a Connect button again after cancelling.
			//
			// Namespaced by CHAIN rather than a single "embedded" prefix,
			// because two worlds are two chains with two different accounts,
			// and the same argument applies between them.
			storagePrefix: `embedded:${spec.chainId}:`,
			// A wallet this world generated signs without asking anybody, so the
			// app must not tell the player their wallet is about to. The same
			// mechanism a local signer uses (`guardDispatch`'s `prompts`), said
			// by the side that knows: the world brought the wallet.
			walletPrompts: wallets ? false : undefined,
			// The chain carries a PROVIDER rather than an rpc url, which is what
			// makes it reachable at all: @etherplay/connect takes either, and reads
			// the provider lazily, per request.
			chainInfo: {
				...deployments.get().chain,
				provider: node.provider as never,
			},
			deployments,
			// Deliberately NOT forwarding `nodeURL`: it would point the connection
			// at the app's remote chain while everything else here describes this
			// one, which is the exact lie a world exists to prevent.
			targetStep: request.targetStep,
			walletHost: request.walletHost,
			walletOnly: request.walletOnly,
			permissions: request.permissions,
		});

	return {
		chainId: spec.chainId,
		provider: node.provider,
		deployments,
		establishConnection,
		env,
		dispose: () => node.dispose(),
	};
}
