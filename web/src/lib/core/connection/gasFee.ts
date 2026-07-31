import type {GetFeeHistoryReturnType, PublicClient} from 'viem';
import type {Readable} from 'svelte/store';
import {
	createPollingStore,
	type PollingStore,
	type PollingValue,
	type PollingStatus,
} from './polling-store';

export type GasPrice = {maxFeePerGas: bigint; maxPriorityFeePerGas: bigint};
export type EstimateGasPriceResult = GasPrice[];

export type GasPriceEstimates = {
	slow: GasPrice;
	average: GasPrice;
	fast: GasPrice;
	baseFeePerGas: bigint;
	higherThanExpected: boolean;
};

export type GasFeeValue = PollingValue<GasPriceEstimates>;
export type GasFeeStatus = PollingStatus;
export type GasFeeStore = PollingStore<GasPriceEstimates>;

// Helper type for when loaded
export type LoadedGasFee = Extract<GasFeeValue, {step: 'Loaded'}>;

/**
 * Effective gas price to display: base fee plus the average priority tip.
 * Pure helper so components don't inline the fee arithmetic.
 */
export function effectiveGasPrice(estimates: GasPriceEstimates): bigint {
	return estimates.baseFeePerGas + estimates.average.maxPriorityFeePerGas;
}

function avg(arr: bigint[]) {
	if (arr.length === 0) return 0n;
	const sum = arr.reduce((a: bigint, v: bigint) => a + v);
	return sum / BigInt(arr.length);
}

/**
 * Headroom applied to the observed base fee when building `maxFeePerGas`,
 * as a percentage (200 = 2x).
 *
 * `maxFeePerGas` is a CEILING, not what gets charged: a transaction only ever
 * pays `baseFeePerGas + min(tip, maxFeePerGas - baseFeePerGas)`. So headroom
 * costs the user nothing in practice, while its absence is fatal - EIP-1559
 * lets the base fee rise 12.5% per block, and a transaction whose
 * `maxFeePerGas` is below the NEXT block's base fee is rejected outright
 * ("maxFeePerGas is too low for the next block").
 *
 * Without this the estimate was exactly `tip + currentBaseFee`, i.e. zero
 * headroom, so any rise at all between polling and sending broke the send.
 * 2x absorbs roughly six consecutive maximum-growth blocks (1.125^6 ~ 2.03),
 * which is also what common node implementations suggest.
 */
const DEFAULT_BASE_FEE_MULTIPLIER_PERCENT = 200n;

export function createGasFeeStore(
	params: {
		publicClient: PublicClient;
		/**
		 * Optional gate: gas fetching only runs while this source is truthy. Used
		 * to avoid polling (and surfacing RPC errors) when the app has no RPC of
		 * its own and the wallet is not connected yet. When omitted, gas is
		 * fetched unconditionally (an app RPC is available).
		 */
		fetchGate?: Readable<boolean>;
	},
	options?: {
		fetchInterval?: number;
		expectedWorstGasPrice?: bigint;
		/** Base-fee headroom percentage; see DEFAULT_BASE_FEE_MULTIPLIER_PERCENT. */
		baseFeeMultiplierPercent?: bigint;
	},
): GasFeeStore {
	const baseFeeMultiplierPercent =
		options?.baseFeeMultiplierPercent ?? DEFAULT_BASE_FEE_MULTIPLIER_PERCENT;
	let feeHistorySupport: 'unknown' | 'supported' | 'unsupported' = 'unknown';
	const {publicClient} = params;

	async function fetchGasPriceEstimates(): Promise<GasPriceEstimates> {
		const blockCount = 20;
		const rewardPercentiles = [10, 50, 80];

		if (feeHistorySupport === 'unknown' || feeHistorySupport === 'supported') {
			try {
				const feeHistory: GetFeeHistoryReturnType =
					await publicClient.getFeeHistory({
						blockCount,
						rewardPercentiles,
						blockTag: 'pending',
					});
				const reward = feeHistory.reward!;

				let blockNum = Number(feeHistory.oldestBlock);
				const lastBlock = blockNum + reward.length;

				if (feeHistory.baseFeePerGas.length < reward.length) {
					throw new Error(
						`feeHistory.baseFeePerGas has less values than feeHistory.reward`,
					);
				}
				if (feeHistory.gasUsedRatio.length < reward.length) {
					throw new Error(
						`feeHistory.gasUsedRatio has less values than feeHistory.reward`,
					);
				}
				let index = 0;
				const blocksHistory: {
					number: number;
					baseFeePerGas: bigint;
					gasUsedRatio: number;
					priorityFeePerGas: bigint[];
				}[] = [];
				while (blockNum < lastBlock) {
					blocksHistory.push({
						number: blockNum,
						baseFeePerGas: feeHistory.baseFeePerGas[index],
						gasUsedRatio: feeHistory.gasUsedRatio[index],
						priorityFeePerGas: reward[index],
					});
					blockNum += 1;
					index += 1;
				}

				const percentilePriorityFeeAverages: bigint[] = [];
				for (let i = 0; i < rewardPercentiles.length; i++) {
					percentilePriorityFeeAverages.push(
						avg(blocksHistory.map((b) => b.priorityFeePerGas[i])),
					);
				}

				const baseFeePerGas =
					feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1];

				// Ceiling gets headroom for future blocks; the reported
				// `baseFeePerGas` below stays the raw observed value, since that is
				// what the UI displays as the current price.
				const baseFeeCeiling =
					(baseFeePerGas * baseFeeMultiplierPercent) / 100n;

				const result: EstimateGasPriceResult = [];
				for (let i = 0; i < rewardPercentiles.length; i++) {
					result.push({
						maxFeePerGas: percentilePriorityFeeAverages[i] + baseFeeCeiling,
						maxPriorityFeePerGas: percentilePriorityFeeAverages[i],
					});
				}
				feeHistorySupport = 'supported';
				return {
					slow: result[0],
					average: result[1],
					fast: result[2],
					baseFeePerGas,
					higherThanExpected: options?.expectedWorstGasPrice
						? result[2].maxFeePerGas > options?.expectedWorstGasPrice
						: false,
				};
			} catch (err: any) {
				if (feeHistorySupport === 'unknown') {
					if (
						'details' in err &&
						(err.details.indexOf('unknown method eth_feeHistory') != -1 ||
							err.details.indexOf('Unknown method eth_feeHistory') != -1)
					) {
						feeHistorySupport = 'unsupported';
					} else {
						throw err;
					}
				} else {
					throw err;
				}
			}
		}

		if (feeHistorySupport === 'unsupported') {
			const gasPrice = await publicClient.getGasPrice();
			// Same headroom reasoning as the feeHistory path above.
			const ceiling = (gasPrice * baseFeeMultiplierPercent) / 100n;
			return {
				slow: {
					maxFeePerGas: ceiling,
					maxPriorityFeePerGas: gasPrice,
				},
				average: {
					maxFeePerGas: ceiling,
					maxPriorityFeePerGas: gasPrice,
				},
				fast: {
					maxFeePerGas: ceiling,
					maxPriorityFeePerGas: gasPrice,
				},
				baseFeePerGas: gasPrice,
				higherThanExpected: options?.expectedWorstGasPrice
					? gasPrice > options?.expectedWorstGasPrice
					: false,
			};
		}

		throw new Error(`could not fallback on getGasPrice`);
	}

	return createPollingStore(
		async () => {
			try {
				return await fetchGasPriceEstimates();
			} catch (err) {
				console.error(`failed to fetch fee history`, err);
				throw err;
			}
		},
		{
			// default: 10 minutes
			fetchInterval: options?.fetchInterval ?? 10 * 60 * 1000,
			...(params.fetchGate ? {source: {store: params.fetchGate}} : {}),
		},
	);
}
