import {offerAmount, reconcileBalance, TRANSFER_GAS} from './funding-math';

/**
 * Reading a payer: the two chain calls, and the rules from `funding-math`
 * applied to what comes back.
 *
 * THIN ON PURPOSE. Everything that decides anything is in `funding-math` and is
 * pure; this file only fetches the two numbers those rules need and hands the
 * answer over. Kept separate so a caller with its own reads can skip it, and so
 * the rules stay testable without a client.
 *
 * The reader is structural rather than viem's `PublicClient`, because the two
 * connections in this app answer for different payers (the app's own client for
 * the signed-in account, the payment rail's for a connected wallet, see
 * `core/connection/remote`) and a caller must be free to pass whichever one
 * matches the payer it is asking about. Passing the wrong one reads the right
 * address on the wrong chain.
 */

/** The two reads a payer's offer is computed from. */
export type BalanceReader = {
	getBalance: (args: {address: `0x${string}`}) => Promise<bigint>;
	estimateFeesPerGas: () => Promise<{maxFeePerGas?: bigint} | undefined>;
	getGasPrice: () => Promise<bigint>;
};

/**
 * The fee a transaction should be priced at.
 *
 * `estimateFeesPerGas` rather than `getGasPrice`, because it is an EIP-1559
 * transaction and `getGasPrice` reports roughly the base fee alone. Reserving
 * that much left out the priority tip, so the reserve was short and the amount
 * offered could exceed what the payer could actually send.
 *
 * Falls back to `getGasPrice` for chains that do not support the estimate at
 * all, which is a legacy chain or a node without a fee history rather than an
 * error worth reporting.
 *
 * NOT `core/connection/gasFee.ts`, and the difference is worth knowing before
 * you reach for either. That module is the app's real fee oracle: it probes
 * `eth_feeHistory` support explicitly, polls, and produces three speeds with
 * documented headroom, which is what you want when PRICING a transaction you
 * are about to send (`balanceCheck.ensureCanAfford` uses it that way). This is
 * a single unpolled read used to SIZE AN OFFER, so it takes whatever reader
 * answers for the payer, needs no store and no lifecycle, and works for a payer
 * on the payment rail that `gasFee` does not track. Note also that `gasFee`
 * already multiplies its base fee, so its output should not then be passed
 * through `gasReserve`; see FEE_SAFETY_MULTIPLIER.
 */
export async function feePerGas(reader: BalanceReader): Promise<bigint> {
	try {
		const fees = await reader.estimateFeesPerGas();
		if (fees?.maxFeePerGas) return fees.maxFeePerGas;
	} catch {
		// Legacy chain, or a node without a fee history. Priced below instead.
	}
	return reader.getGasPrice();
}

/** What a payer can send, and whether that figure is ahead of the chain read. */
export type Sendable = {
	value: bigint;
	/**
	 * The amount is ahead of what the chain reported, because we watched the
	 * money arrive. The wallet may still be showing the old balance and refuse to
	 * sign until it catches up; saying so beats a user staring at a wallet that
	 * claims they have nothing while the app insists they do.
	 */
	pending: boolean;
};

/**
 * What this payer could send right now, after the gas of sending it.
 *
 * `gas` depends on WHAT is being sent (a plain transfer, a contract call, a
 * call that also forwards a stipend), so it is a parameter rather than a
 * constant: see `gasReserve`.
 *
 * `ceiling` is the most the caller wants regardless of what the payer holds.
 *
 * `knownToHold` is how a caller defeats a wallet that has not caught up yet.
 * Pass what a faucet reported dispensing and a stale `eth_getBalance` can no
 * longer report the payer as empty. See `reconcileBalance`, which is where that
 * failure is explained.
 */
export async function readSendable(
	reader: BalanceReader,
	params: {
		address: `0x${string}`;
		ceiling: bigint;
		gas?: bigint;
		knownToHold?: bigint;
	},
): Promise<Sendable> {
	const [reported, maxFeePerGas] = await Promise.all([
		reader.getBalance({address: params.address}),
		feePerGas(reader),
	]);
	const {balance, behind} = reconcileBalance({
		reported,
		knownToHold: params.knownToHold,
	});
	return {
		value: offerAmount({
			balance,
			maxFeePerGas,
			ceiling: params.ceiling,
			gas: params.gas ?? TRANSFER_GAS,
		}),
		pending: behind,
	};
}
