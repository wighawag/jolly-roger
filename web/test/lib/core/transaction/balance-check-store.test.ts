import {describe, it, expect, vi} from 'vitest';
import {readable, writable, get} from 'svelte/store';
import {createBalanceCheckStore} from '$lib/core/transaction/balance-check-store';
import type {BalanceStore} from '$lib/core/connection/balance';
import type {GasFeeStore, GasPriceEstimates} from '$lib/core/connection/gasFee';
import type {PublicClient} from 'viem';

const ADDR = '0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA' as const;

function fakeBalance(value: bigint): BalanceStore {
	return {
		subscribe: readable({step: 'Loaded', value} as const).subscribe,
		status: readable({loading: false}).subscribe as any,
		update: async () => ({step: 'Loaded', value}) as any,
	} as unknown as BalanceStore;
}

function fakeGasFee(estimate: GasPriceEstimates): GasFeeStore {
	return {
		subscribe: readable({step: 'Loaded', ...estimate} as const).subscribe,
		status: readable({loading: false}).subscribe as any,
		update: async () => ({step: 'Loaded', ...estimate}) as any,
	} as unknown as GasFeeStore;
}

// A realistic low-fee estimate (fresh local node): fast priority 1 gwei,
// maxFee just above it. The point of the fix is that the request carries the
// matching maxPriorityFeePerGas, never a bare maxFeePerGas.
const estimate: GasPriceEstimates = {
	slow: {maxFeePerGas: 300_000_000n, maxPriorityFeePerGas: 100_000_000n},
	average: {maxFeePerGas: 600_000_000n, maxPriorityFeePerGas: 500_000_000n},
	fast: {maxFeePerGas: 1_100_000_000n, maxPriorityFeePerGas: 1_000_000_000n},
	baseFeePerGas: 100_000_000n,
	higherThanExpected: false,
};

/**
 * A gas store that starts Unloaded and only produces a value when asked.
 *
 * This is the shape the app is actually in when a transaction is started from a
 * disconnected page: the gas poller is gated on being able to read the chain,
 * so it has nothing until the wallet connects, and the first fetch is still in
 * flight when the transaction reaches the fee lookup.
 */
function lazyGasFee(estimate: GasPriceEstimates, options: {loads: boolean}) {
	const value = writable<unknown>({step: 'Unloaded'});
	const update = vi.fn(async () => {
		if (options.loads) {
			value.set({step: 'Loaded', ...estimate});
		}
		return get(value);
	});
	return {
		store: {
			subscribe: value.subscribe,
			status: readable({loading: false}).subscribe as any,
			update,
		} as unknown as GasFeeStore,
		update,
	};
}

describe('balanceCheck.ensureCanAfford', () => {
	it('returns a request carrying BOTH maxFeePerGas and maxPriorityFeePerGas', async () => {
		const publicClient = {
			estimateContractGas: vi.fn(async () => 21_000n),
		} as unknown as PublicClient;

		const balance = fakeBalance(10n ** 18n);
		const store = createBalanceCheckStore({
			publicClient,
			gasFee: fakeGasFee(estimate),
		});

		const request = await store.ensureCanAfford(
			{
				contract: {
					address: ADDR,
					abi: [],
					functionName: 'setMessage',
					args: ['hi'],
					account: ADDR,
				},
			},
			{balance, sender: ADDR},
		);

		// The fix: both fee fields present, from the chosen (default: fast) tier.
		expect(request.maxFeePerGas).toBe(estimate.fast.maxFeePerGas);
		expect(request.maxPriorityFeePerGas).toBe(
			estimate.fast.maxPriorityFeePerGas,
		);
		// Invariant that avoids "maxFeePerGas < maxPriorityFeePerGas".
		expect(request.maxFeePerGas! >= request.maxPriorityFeePerGas!).toBe(true);
		expect(request.gas).toBe(21_000n);
	});

	it('uses the requested speed tier', async () => {
		const publicClient = {
			estimateContractGas: vi.fn(async () => 21_000n),
		} as unknown as PublicClient;

		const balance = fakeBalance(10n ** 18n);
		const store = createBalanceCheckStore({
			publicClient,
			gasFee: fakeGasFee(estimate),
		});

		const request = await store.ensureCanAfford(
			{
				contract: {
					address: ADDR,
					abi: [],
					functionName: 'setMessage',
					args: ['hi'],
					account: ADDR,
				},
			},
			{balance, sender: ADDR, gasSpeed: 'slow'},
		);

		expect(request.maxFeePerGas).toBe(estimate.slow.maxFeePerGas);
		expect(request.maxPriorityFeePerGas).toBe(
			estimate.slow.maxPriorityFeePerGas,
		);
	});

	it('waits for the gas price instead of failing when it has not loaded yet', async () => {
		// The bug this covers: sending from a disconnected page went through the
		// connection flow and then died on "Gas fee not loaded". The gas poller only
		// starts once the app can read the chain, so it is still fetching in the tick
		// the transaction resumes. Losing the transaction to that race is not
		// something the user can see, understand or retry their way out of.
		const publicClient = {
			estimateContractGas: vi.fn(async () => 21_000n),
		} as unknown as PublicClient;
		const gas = lazyGasFee(estimate, {loads: true});

		const balance = fakeBalance(10n ** 18n);
		const store = createBalanceCheckStore({
			publicClient,
			gasFee: gas.store,
		});

		const request = await store.ensureCanAfford(
			{
				contract: {
					address: ADDR,
					abi: [],
					functionName: 'setMessage',
					args: ['hi'],
					account: ADDR,
				},
			},
			{balance, sender: ADDR},
		);

		expect(gas.update).toHaveBeenCalled();
		expect(request.maxFeePerGas).toBe(estimate.fast.maxFeePerGas);
		expect(request.maxPriorityFeePerGas).toBe(
			estimate.fast.maxPriorityFeePerGas,
		);
	});

	it('says what is wrong when the gas price genuinely cannot be read', async () => {
		// Waiting is not the same as pretending: if the chain still will not give a
		// gas price, the transaction must stop, and say so in words rather than
		// leaking an internal "Gas fee not loaded".
		const publicClient = {
			estimateContractGas: vi.fn(async () => 21_000n),
		} as unknown as PublicClient;
		const gas = lazyGasFee(estimate, {loads: false});

		const balance = fakeBalance(10n ** 18n);
		const store = createBalanceCheckStore({
			publicClient,
			gasFee: gas.store,
		});

		await expect(
			store.ensureCanAfford(
				{
					contract: {
						address: ADDR,
						abi: [],
						functionName: 'setMessage',
						args: ['hi'],
						account: ADDR,
					},
				},
				{balance, sender: ADDR},
			),
		).rejects.toThrow(/gas price/i);

		expect(gas.update).toHaveBeenCalled();
	});
});

/**
 * WHO WAS FUNDED, and whether that unblocks the transaction being waited on.
 *
 * The store is what knows which account a blocked transaction is short on, so
 * it is what decides whether a funding event is the one it is waiting for. That
 * used to be the CALLER's decision, taken by comparing the funded address
 * against the authenticated account's executor, which is a rule that reads
 * "there are two payers and this is not the other one". A third payer exists (a
 * wallet on the payment rail), and under that comparison funding it counted as
 * funding nobody: the modal went on waiting for a change to an account nobody
 * had touched, immediately after sending money to the account that was short.
 */
describe('balanceCheck.markFundingRequested', () => {
	const SIGNER = '0xbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbB' as const;

	function blockedOn(sender: `0x${string}`, balance = 0n) {
		const store = createBalanceCheckStore({
			publicClient: {} as unknown as PublicClient,
			gasFee: fakeGasFee(estimate),
		});
		store.showInsufficientFunds({
			balanceStore: fakeBalance(balance),
			sender,
			estimatedCost: 1000n,
			onContinue: () => {},
			onDismiss: () => {},
		});
		return store;
	}

	it('starts waiting when the funded account is the one that is short', () => {
		const store = blockedOn(ADDR);
		store.markFundingRequested(ADDR);
		expect((get(store) as any).isWaitingForBalanceUpdate).toBe(true);
		store.close();
	});

	it('starts waiting for ANY payer that is short, not just the account', () => {
		// The rail case. Nothing here knows which kind of payer this is, and that
		// is the point: the rule is "is this the account I am blocked on".
		const store = blockedOn(SIGNER);
		store.markFundingRequested(SIGNER);
		expect((get(store) as any).isWaitingForBalanceUpdate).toBe(true);
		store.close();
	});

	it('ignores funding aimed at an account it is not waiting on', () => {
		// A top-up faucets the PAYER before it can buy anything, while the blocked
		// transaction is short on someone else entirely. Believing that would leave
		// the modal waiting for a change that is never coming, and then inviting
		// the user to continue into the same failure.
		const store = blockedOn(ADDR);
		store.markFundingRequested(SIGNER);
		expect((get(store) as any).isWaitingForBalanceUpdate).toBe(false);
		store.close();
	});

	it('ignores an unknown funded address rather than assuming it matched', () => {
		const store = blockedOn(ADDR);
		store.markFundingRequested(undefined);
		expect((get(store) as any).isWaitingForBalanceUpdate).toBe(false);
		store.close();
	});

	it('matches case-insensitively', () => {
		// These two arrive from different places (a caller, an executor store) and
		// disagree about EIP-55 casing. A strict compare silently skips the notice.
		const store = blockedOn(ADDR);
		store.markFundingRequested(ADDR.toLowerCase() as `0x${string}`);
		expect((get(store) as any).isWaitingForBalanceUpdate).toBe(true);
		store.close();
	});

	it('reads the pre-funding balance from the store it is watching', () => {
		// Not from whatever the caller happened to have. Sampling the account's
		// balance for a claim made on another payer's behalf yields a figure the
		// poller can never see move.
		const store = blockedOn(ADDR, 250n);
		store.markFundingRequested(ADDR);
		expect((get(store) as any).preFaucetBalance).toBe(250n);
		store.close();
	});

	it('is a no-op when nothing is blocked', () => {
		const store = createBalanceCheckStore({
			publicClient: {} as unknown as PublicClient,
			gasFee: fakeGasFee(estimate),
		});
		store.markFundingRequested(ADDR);
		expect(get(store).step).toBe('idle');
	});
});
