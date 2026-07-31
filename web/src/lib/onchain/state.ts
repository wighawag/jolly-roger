import type {TypedDeployments} from '$lib/core/connection/types';
import {
	createPollingStore,
	type PollingStore,
	type PollingValue,
	type PollingStatus,
} from '$lib/core/connection/polling-store';
import type {PublicClient} from 'viem';
import type {Readable} from 'svelte/store';

export type Message = {
	readonly account: `0x${string}`;
	readonly message: string;
	readonly timestamp: number;
};

export type OnchainStateValue = PollingValue<{messages: readonly Message[]}>;
export type OnchainStateStatus = PollingStatus;
export type OnchainStateStore = PollingStore<{messages: readonly Message[]}>;

export function createOnchainState(params: {
	publicClient: PublicClient;
	deployments: TypedDeployments;
	config: {
		maxMessages: number;
		fetchInterval?: number;
	};
	/**
	 * Optional gate: chain reads only run while this source is truthy. Used to
	 * avoid fetching (and surfacing an RPC error) when the app has no RPC of its
	 * own and the wallet is not connected yet. When omitted, reads run
	 * unconditionally (an app RPC is available).
	 */
	fetchGate?: Readable<boolean>;
}): OnchainStateStore {
	const {publicClient, deployments, config} = params;

	return createPollingStore(
		async () => {
			const valueFromContracts = await publicClient.readContract({
				...deployments.contracts.GreetingsRegistry,
				functionName: 'getLastMessages',
				args: [BigInt(config.maxMessages)],
			});
			const messages: readonly Message[] = valueFromContracts.map((v) => ({
				...v,
				timestamp: Number(v.timestamp) * 1000,
			}));
			return {messages};
		},
		{
			fetchInterval: config.fetchInterval ?? 5_000,
			...(params.fetchGate ? {source: {store: params.fetchGate}} : {}),
		},
	);
}
