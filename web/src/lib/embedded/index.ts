/**
 * AN EMBEDDED CHAIN: the mechanism, with no route and no opinion about what a
 * game does with it.
 *
 * `embedded-chain` is the MECHANISM's word and belongs to the framework;
 * `offline` is the EXPERIENCE a player chooses and belongs to the game. Nothing
 * in this folder says `offline`, deliberately, and a game's own launch menu
 * should.
 *
 * WHY THE MECHANISM IS HERE AND NOT IN THE ROUTE THAT DEMOS IT. A descendant of
 * this template deletes inherited demo routes (template-commit-reveal deleted
 * `routes/demo/` and takes the resulting `CONFLICT (modify/delete)` on every
 * merge), so anything world-building written inside a route is thrown away by
 * the repos that most want it. The route is the demo; this is the thing.
 */
export {createEmbeddedWorld, restoreIsCoherent} from './world.js';
export type {
	EmbeddedWorld,
	EmbeddedWorldSpec,
	ProvisionParams,
} from './world.js';
export {startEmbeddedNode} from './node.js';
export {announceEmbeddedWallet} from './wallet.js';
export type {EmbeddedWallet} from './wallet.js';
export type {EmbeddedNode, StartEmbeddedNodeParams} from './node.js';
export {deployWorldContracts, composeWorldConfig} from './deploy.js';
export {
	createEmbeddedDeployments,
	expectedContractNames,
} from './deployments.js';
export type {EmbeddedChainMetadata} from './deployments.js';
export {
	mintChainId,
	rememberChainId,
	isEmbeddedChainId,
	MIN_EMBEDDED_CHAIN_ID,
	MAX_EMBEDDED_CHAIN_ID,
	MAX_CHAIN_ID,
} from './chain-id.js';
export type {DeployScript, EIP1193ProviderLike, RockethSetup} from './types.js';
