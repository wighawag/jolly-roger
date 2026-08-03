import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {get} from 'svelte/store';
import {createGasFeeStore} from '$lib/core/connection/gasFee';
import type {PublicClient} from 'viem';

function activate<T>(store: {subscribe: (r: (v: T) => void) => () => void}) {
	return store.subscribe(() => {});
}

/**
 * Minimal getFeeHistory return with a single block whose per-percentile rewards
 * are [10, 50, 80] and baseFeePerGas [100, 100]. Averages over one block are the
 * values themselves, so slow/avg/fast maxPriorityFeePerGas = 10/50/80, and
 * maxFeePerGas = priority + the baseFee CEILING, i.e. the last baseFee (100)
 * scaled by the default 2x headroom = 200.
 */
function feeHistoryOneBlock() {
	return {
		oldestBlock: 0n,
		reward: [[10n, 50n, 80n]],
		baseFeePerGas: [100n, 100n],
		gasUsedRatio: [0.5],
	};
}

describe('createGasFeeStore (adapter)', () => {
	// Polling stores only poll in a browser (ADR-0002), and this project is Node
	// with no DOM, so declare the global the guard looks for. The off-browser
	// behaviour itself is covered in polling-store.test.ts.
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('computes slow/average/fast from eth_feeHistory percentiles', async () => {
		const getFeeHistory = vi.fn(async () => feeHistoryOneBlock());
		const publicClient = {getFeeHistory} as unknown as PublicClient;

		const store = createGasFeeStore({publicClient});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store).step).toBe('Loaded'));
		const v = get(store);
		if (v.step !== 'Loaded') throw new Error('not loaded');

		// reported base fee stays the RAW observed value (this is what the UI shows)
		expect(v.baseFeePerGas).toBe(100n);
		// ceilings carry 2x headroom so a rising base fee cannot strand the tx
		expect(v.slow).toEqual({maxPriorityFeePerGas: 10n, maxFeePerGas: 210n});
		expect(v.average).toEqual({maxPriorityFeePerGas: 50n, maxFeePerGas: 250n});
		expect(v.fast).toEqual({maxPriorityFeePerGas: 80n, maxFeePerGas: 280n});
		expect(v.higherThanExpected).toBe(false);
		off();
	});

	it('keeps maxFeePerGas above the next block worst-case base fee', async () => {
		// The regression this guards: maxFeePerGas used to be priority + the
		// CURRENT base fee, so any EIP-1559 increase (up to 12.5% per block) made
		// the transaction unsendable with "maxFeePerGas is too low for the next
		// block". The ceiling must survive several consecutive max-growth blocks.
		const getFeeHistory = vi.fn(async () => feeHistoryOneBlock());
		const publicClient = {getFeeHistory} as unknown as PublicClient;

		const store = createGasFeeStore({publicClient});
		const off = activate(store);
		await vi.waitFor(() => expect(get(store).step).toBe('Loaded'));
		const v = get(store);
		if (v.step !== 'Loaded') throw new Error('not loaded');

		// six blocks of maximum growth: 100 * 1.125^6 ~ 202
		let worstCaseBaseFee = v.baseFeePerGas;
		for (let i = 0; i < 6; i++) {
			worstCaseBaseFee = (worstCaseBaseFee * 1125n) / 1000n;
		}
		expect(v.fast.maxFeePerGas).toBeGreaterThan(worstCaseBaseFee);
		off();
	});

	it('honours an explicit base-fee headroom', async () => {
		const getFeeHistory = vi.fn(async () => feeHistoryOneBlock());
		const publicClient = {getFeeHistory} as unknown as PublicClient;

		// 100% = no headroom, i.e. the old behaviour, still reachable explicitly.
		const store = createGasFeeStore(
			{publicClient},
			{baseFeeMultiplierPercent: 100n},
		);
		const off = activate(store);
		await vi.waitFor(() => expect(get(store).step).toBe('Loaded'));
		const v = get(store);
		if (v.step !== 'Loaded') throw new Error('not loaded');
		expect(v.fast).toEqual({maxPriorityFeePerGas: 80n, maxFeePerGas: 180n});
		off();
	});

	it('flags higherThanExpected when fast exceeds expectedWorstGasPrice', async () => {
		const getFeeHistory = vi.fn(async () => feeHistoryOneBlock());
		const publicClient = {getFeeHistory} as unknown as PublicClient;

		const store = createGasFeeStore(
			{publicClient},
			{expectedWorstGasPrice: 150n}, // fast.maxFeePerGas is 280n > 150n
		);
		const off = activate(store);

		await vi.waitFor(() => expect(get(store).step).toBe('Loaded'));
		const v = get(store);
		if (v.step !== 'Loaded') throw new Error('not loaded');
		expect(v.higherThanExpected).toBe(true);
		off();
	});

	it('falls back to getGasPrice when the node lacks eth_feeHistory', async () => {
		const err = Object.assign(new Error('rpc'), {
			details: 'unknown method eth_feeHistory',
		});
		const getFeeHistory = vi.fn(async () => {
			throw err;
		});
		const getGasPrice = vi.fn(async () => 7n);
		const publicClient = {
			getFeeHistory,
			getGasPrice,
		} as unknown as PublicClient;

		const store = createGasFeeStore({publicClient});
		const off = activate(store);

		await vi.waitFor(() => expect(get(store).step).toBe('Loaded'));
		const v = get(store);
		if (v.step !== 'Loaded') throw new Error('not loaded');
		// fallback: flat gas price as the tip, with the same ceiling headroom
		expect(v.slow).toEqual({maxPriorityFeePerGas: 7n, maxFeePerGas: 14n});
		expect(v.fast).toEqual({maxPriorityFeePerGas: 7n, maxFeePerGas: 14n});
		expect(v.baseFeePerGas).toBe(7n);
		off();
	});
});
