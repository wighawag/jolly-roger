/**
 * WHAT the greetings' indexer folds: GreetingsRegistry, and of its ABI only the
 * events `./processor.ts` has a handler for. The source is part of the
 * stream's digest, so it is built in this one place.
 */
import {greetingsProcessor} from './processor';

/**
 * The stream's finality, in blocks: how far below the tip a block is taken as
 * final. It does not delay the fold (the head is folded too, and rolled back on
 * a reorg); it bounds the reorg window a store keeps history for.
 */
export const STREAM_FINALITY = 12;

/** This app's word for its indexer's workers and databases (`$lib/indexer/worker-choice`). */
export const INDEXER_PREFIX = 'greetings';

type AbiEntry = {readonly type: string; readonly name?: string};

type ContractInfo = {
	readonly abi: readonly AbiEntry[];
	readonly address: `0x${string}`;
	readonly startBlock?: number;
};

/** A deployment, as far as the source reads it. */
export type ContractsInfo = {
	readonly chain: {readonly id: number; readonly genesisHash?: string};
	readonly contracts: {readonly GreetingsRegistry: ContractInfo};
};

/** The events the processor has a handler for, each once. */
function handled(abi: readonly AbiEntry[]): AbiEntry[] {
	const seen = new Set<string>();
	return abi.flatMap((entry) => {
		if (
			entry.type !== 'event' ||
			entry.name === undefined ||
			typeof (greetingsProcessor as unknown as Record<string, unknown>)[
				`on${entry.name}`
			] !== 'function'
		) {
			return [];
		}
		const key = JSON.stringify(entry);
		if (seen.has(key)) return [];
		seen.add(key);
		return [{...entry}];
	});
}

export function indexingSource(info: ContractsInfo) {
	const registry = info.contracts.GreetingsRegistry;
	return {
		chainId: String(info.chain.id),
		...(info.chain.genesisHash
			? {genesisHash: info.chain.genesisHash as `0x${string}`}
			: {}),
		contracts: [
			{
				abi: handled(registry.abi),
				address: registry.address,
				...(registry.startBlock !== undefined
					? {startBlock: registry.startBlock}
					: {}),
			},
		],
	};
}
