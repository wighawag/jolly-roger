import {createNode, type NodeOptions, type SlimNode} from 'webevm';
import type {EIP1193ProviderLike} from './types.js';

/**
 * THE CHAIN IN THE TAB.
 *
 * `webevm` is execution-only: it holds no keys and answers `eth_accounts`,
 * `eth_sendTransaction` and `eth_sign` with a real `-32601`. That is not a gap
 * to work around, it is the reason a world can be honest about who signs -
 * everything is a signed raw transaction, exactly as it is against a remote
 * chain, so nothing in the app takes a different path because the chain is
 * local.
 */
export type EmbeddedNode = {
	chainId: number;
	/** The EIP-1193 surface the app's clients and the wallet both talk to. */
	provider: EIP1193ProviderLike;
	/** The node itself, for the things only its owner may do: mine, dump, load. */
	node: SlimNode;
	dispose(): Promise<void>;
};

export type StartEmbeddedNodeParams = {
	chainId: number;
	/** Pre-funded accounts. See `provision.ts` for the rest of what a player needs. */
	initialBalances?: Record<string, bigint>;
	persistence?: NodeOptions['persistence'];
	blockGasLimit?: bigint;
	/**
	 * The node factory. Injected ONLY so a caller can supply a Worker-hosted node
	 * (`createWorkerNode`) or a faster engine without this module knowing about
	 * either. Defaults to the main-thread one.
	 */
	createNode?: typeof createNode;
};

/**
 * MINING IS `auto` AND HAS NO INTERVAL, and this is the decision most likely to
 * be "fixed" by someone who has not measured it.
 *
 * An embedded world does not run on a clock. It serves single-player and
 * hotseat, where the human decides when a turn ends, so it runs the MANUAL
 * cycle policy: both phase durations are zero and the cycle moves because
 * somebody pushed it. Nothing reads a block time, so blocks mined on a timer
 * would be blocks nobody reads.
 *
 * An interval also COSTS two things rather than merely wasting CPU. It creates
 * a mempool, and in the tab there is no second node holding it, so a
 * transaction resident in it exists in exactly one place; automine mines one
 * block per raw transaction, so nothing is ever resident. And it moves the
 * chain's clock underneath a game that has deliberately been given no clock.
 *
 * THE ONE THING TO KNOW BEFORE DEPLOYING A *TIMED* GAME IN THE TAB, measured
 * 2026-09-19: `eth_call` and `eth_estimateGas` run against the LAST MINED
 * BLOCK, with that block's timestamp, and under automine a block exists only
 * where a transaction happened. So between transactions the chain's view of
 * time is frozen at the last one. A timed game therefore cannot even ESTIMATE
 * a reveal after its commit phase closes - the estimate runs at the commit's
 * timestamp and reverts with `InCommitmentPhase` - until something mines. That
 * is not a bug to route around here; it is what makes `Manual` the policy an
 * embedded world runs, and a timed embedded world would need blocks mined for
 * the sole purpose of advancing a clock.
 */
const MINING = {type: 'auto'} as const;

export async function startEmbeddedNode(
	params: StartEmbeddedNodeParams,
): Promise<EmbeddedNode> {
	const {
		chainId,
		initialBalances,
		persistence,
		blockGasLimit,
		createNode: create = createNode,
	} = params;

	const node = await create({
		chainId,
		miningConfig: MINING,
		...(initialBalances ? {initialBalances} : {}),
		...(persistence ? {persistence} : {}),
		...(blockGasLimit === undefined ? {} : {blockGasLimit}),
	});

	// A plain object rather than the node itself: what the app's clients and the
	// wallet are handed must be an EIP-1193 surface and nothing more, so nobody
	// downstream can reach `dumpState` or `mine` off the provider they were
	// given. Rewinding the chain is the world owner's, not a caller's.
	const provider: EIP1193ProviderLike = {
		request: (args) =>
			node.request(
				args as Parameters<SlimNode['request']>[0],
			) as Promise<unknown>,
	};

	return {
		chainId,
		provider,
		node,
		async dispose() {
			await node.dispose?.();
		},
	};
}
