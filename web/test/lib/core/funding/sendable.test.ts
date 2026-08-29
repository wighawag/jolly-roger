import {describe, it, expect, vi} from 'vitest';
import {feePerGas, readSendable, type BalanceReader} from '$lib/core/funding';

/**
 * Nothing on this branch imports `core/funding`; see the header of
 * `funding-math.test.ts` for why it is here and why it is tested anyway.
 *
 * This file covers the only part of the directory that performs IO. The reader
 * is a stub rather than a viem client, because what is being tested is which
 * reads happen and which rules are applied to them, not viem.
 */

const GWEI = 1_000_000_000n;
const ETH = 10n ** 18n;
const PAYER = '0x00000000000000000000000000000000000000bB' as const;
const TRANSFER_COST = 21_000n * GWEI * 2n;

function reader(params: {
	balance: bigint;
	maxFeePerGas?: bigint;
	estimateThrows?: boolean;
	gasPrice?: bigint;
}): BalanceReader {
	return {
		getBalance: vi.fn(async () => params.balance),
		estimateFeesPerGas: vi.fn(async () => {
			if (params.estimateThrows) throw new Error('no fee history');
			return params.maxFeePerGas ? {maxFeePerGas: params.maxFeePerGas} : {};
		}),
		getGasPrice: vi.fn(async () => params.gasPrice ?? GWEI),
	};
}

describe('feePerGas: pricing an EIP-1559 transaction', () => {
	it('prefers the fee estimate, which includes the priority tip', () => {
		// getGasPrice reports roughly the base fee alone, so reserving that much
		// left the reserve short and the offer above what the payer could send.
		return expect(
			feePerGas(reader({balance: 0n, maxFeePerGas: 7n})),
		).resolves.toBe(7n);
	});

	it('falls back to the gas price on a chain without a fee history', async () => {
		// A legacy chain or a node without eth_feeHistory. Not an error worth
		// reporting: it is priced the other way instead.
		expect(
			await feePerGas(
				reader({balance: 0n, estimateThrows: true, gasPrice: 5n}),
			),
		).toBe(5n);
	});

	it('falls back when the estimate answers without a maxFeePerGas', async () => {
		expect(await feePerGas(reader({balance: 0n, gasPrice: 5n}))).toBe(5n);
	});
});

describe('readSendable: what this payer can send right now', () => {
	it('offers the ceiling when the payer can cover it', async () => {
		const sendable = await readSendable(
			reader({balance: ETH, maxFeePerGas: GWEI}),
			{address: PAYER, ceiling: ETH / 100n},
		);
		expect(sendable).toEqual({value: ETH / 100n, pending: false});
	});

	it('offers what is left after gas when the payer holds less', async () => {
		const balance = ETH / 1000n;
		const sendable = await readSendable(reader({balance, maxFeePerGas: GWEI}), {
			address: PAYER,
			ceiling: ETH,
		});
		expect(sendable.value).toBe(balance - TRANSFER_COST);
	});

	it('keeps back a contract call worth of gas when told the send is one', async () => {
		const sendable = await readSendable(
			reader({balance: ETH, maxFeePerGas: GWEI}),
			{address: PAYER, ceiling: ETH, gas: 150_000n},
		);
		expect(sendable.value).toBe(ETH - 150_000n * GWEI * 2n);
	});

	it('trusts what a faucet dispensed over a wallet balance that is behind', async () => {
		// The read says empty because the injected wallet has not seen the block
		// yet. Believing it tells a freshly funded user they have nothing.
		const sendable = await readSendable(
			reader({balance: 0n, maxFeePerGas: GWEI}),
			{address: PAYER, ceiling: ETH, knownToHold: ETH / 1000n},
		);
		expect(sendable.value).toBe(ETH / 1000n - TRANSFER_COST);
		expect(sendable.pending).toBe(true);
	});

	it('says nothing about a lag when the read already agrees', async () => {
		const sendable = await readSendable(
			reader({balance: ETH, maxFeePerGas: GWEI}),
			{address: PAYER, ceiling: ETH / 100n, knownToHold: ETH / 1000n},
		);
		expect(sendable.pending).toBe(false);
	});

	it('reads the address it was given, on the reader it was given', async () => {
		// The two connections in this app answer for different payers, so passing
		// the wrong reader reads the right address on the wrong chain.
		const r = reader({balance: ETH, maxFeePerGas: GWEI});
		await readSendable(r, {address: PAYER, ceiling: ETH});
		expect(r.getBalance).toHaveBeenCalledWith({address: PAYER});
	});
});
