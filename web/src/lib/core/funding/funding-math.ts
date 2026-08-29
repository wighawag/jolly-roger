import {formatUnits} from 'viem';

/**
 * The arithmetic of "how much can this payer actually send".
 *
 * PURE, and deliberately so: every rule here is one a descendant otherwise
 * re-derives from a bug report. There is no client, no store and no wallet in
 * this file, so each rule can be tested by stating a balance and reading an
 * answer, and none of them needs a chain to be wrong in an obvious way.
 *
 * The functions are small; the reasons are not, which is why the reasons are
 * written down. Each one exists because sending the naive figure fails, and the
 * comment says which failure.
 *
 * NOTHING HERE KNOWS WHAT THE MONEY IS FOR. The amount is capped by a `ceiling`
 * the caller supplies, so a template pricing a top-up in credits and a game
 * pricing an item both use these unchanged. See `core/funding/README.md`.
 */

/** Gas a plain native transfer costs. The floor for any value-carrying send. */
export const TRANSFER_GAS = 21_000n;

/**
 * How much the fee estimate is multiplied by before it is held back.
 *
 * The app does not choose what a transaction costs: it is sent through the
 * user's wallet, and the wallet picks the fee. A wallet routinely picks more
 * than `estimateFeesPerGas` returns (it adds its own priority tip, and the base
 * fee can rise between the estimate and the send), so reserving the estimate
 * exactly produces the bug this exists to stop: an amount sized at "everything
 * the payer has, minus gas" that the payer then cannot afford to send.
 *
 * Two, because the reserve is only ever a few cents of gas, while getting it
 * wrong costs the user a failed transaction and a confusing wallet error.
 *
 * THIS ASSUMES A RAW ESTIMATE. It is sized for what `estimateFeesPerGas` (or
 * `readSendable`) returns. `core/connection/gasFee.ts` builds its `maxFeePerGas`
 * with its own 2x base-fee headroom already applied
 * (`DEFAULT_BASE_FEE_MULTIPLIER_PERCENT`), so passing `estimates.fast.maxFeePerGas`
 * in here reserves roughly four times the base fee. That is conservative rather
 * than wrong, but on an expensive chain it visibly shrinks what a freshly
 * fauceted payer can offer, so prefer the raw estimate when sizing an offer and
 * keep `gasFee`'s speeds for pricing a transaction you are about to send.
 */
export const FEE_SAFETY_MULTIPLIER = 2n;

/**
 * Gas the transaction itself costs, which the payer must keep back.
 *
 * The gas is a PARAMETER because it depends on what is being sent. Reserving a
 * transfer's gas for a contract call sizes an amount the payer cannot afford to
 * send, which is the exact failure the reserve exists to prevent.
 */
export function gasReserve(
	maxFeePerGas: bigint,
	gas: bigint = TRANSFER_GAS,
): bigint {
	return gas * maxFeePerGas * FEE_SAFETY_MULTIPLIER;
}

/**
 * What the payer can actually send: its balance minus the gas of sending.
 *
 * Zero rather than negative when the balance does not even cover gas, because
 * the caller's question is "how much can be sent", and the answer there is
 * none. Sending the whole balance always fails, which is the failure this
 * subtraction exists to prevent.
 */
export function spendableBalance(params: {
	balance: bigint;
	maxFeePerGas: bigint;
	gas?: bigint;
}): bigint {
	const reserve = gasReserve(params.maxFeePerGas, params.gas);
	return params.balance > reserve ? params.balance - reserve : 0n;
}

/**
 * What this payer will actually send, right now: the lower of what the caller
 * is asking for and what the payer can cover.
 *
 * Taking the minimum is what makes a faucet enough. A freshly fauceted payer
 * holds exactly the faucet's amount, and this lands under it by the cost of the
 * transaction instead of attempting a fixed price the payer cannot cover, which
 * would fail in the wallet for a reason the app could have predicted.
 *
 * `ceiling` is the caller's price: a fixed top-up, an item's cost, or a
 * constant when nothing prices it. Keeping it a plain bigint is what keeps this
 * function usable by a game that has something to sell.
 */
export function offerAmount(params: {
	balance: bigint;
	maxFeePerGas: bigint;
	ceiling: bigint;
	gas?: bigint;
}): bigint {
	const spendable = spendableBalance(params);
	return spendable < params.ceiling ? spendable : params.ceiling;
}

/** A balance to price against, and whether it is ahead of what the chain said. */
export type ReconciledBalance = {
	balance: bigint;
	/**
	 * The figure is ahead of the chain read, because we watched the money
	 * arrive. The transaction is fine to send, but the WALLET may still refuse.
	 */
	behind: boolean;
};

/**
 * Reconcile what the chain reported with what we KNOW the payer holds.
 *
 * THE FAILURE THIS EXISTS FOR, because nobody expects it until it bites: an
 * injected wallet answers `eth_getBalance` from a cache until it sees a new
 * block, so a read straight after a faucet claim reports the balance from
 * BEFORE the claim. Believing it tells a user who was just funded that their
 * account is empty, and offers them a retry that can only re-read the same
 * stale figure.
 *
 * Taking the larger of the two means a wallet that has not caught up cannot
 * walk a funded payer back to empty, and a wallet that HAS caught up still wins
 * when it knows more (the payer may have held something already).
 *
 * The result says when it is optimistic rather than hiding it. Ethereum's nonce
 * ordering means a transaction sent now is fine even if the node answering us
 * is behind, but the wallet has to agree before it will let the user sign, and
 * a wallet that is behind shows the old balance and refuses. So the caller is
 * told, and can say so, rather than either refusing or pretending everything is
 * settled.
 */
export function reconcileBalance(params: {
	/** What the chain read said. */
	reported: bigint;
	/**
	 * A balance the payer holds regardless of what the chain says, because we
	 * just watched it arrive (a faucet's own report of what it dispensed).
	 */
	knownToHold?: bigint;
}): ReconciledBalance {
	const {reported, knownToHold} = params;
	const behind = !!knownToHold && knownToHold > reported;
	return {balance: behind ? knownToHold : reported, behind};
}

/**
 * Can the payer cover this exact amount, gas included?
 *
 * Checked BEFORE the transaction reaches the wallet. Without it the wallet is
 * the thing that discovers the shortfall, and it reports it in its own words,
 * in a popup the user has to dismiss, about a number they cannot see.
 *
 * Gas is included rather than compared against `value` alone: sending exactly
 * the balance always fails, and failing at the wallet for a reason the app
 * could have predicted is the case this exists to remove.
 *
 * Note this uses the RAW fee, not the safety-multiplied reserve: it answers
 * "will this go through", where `spendableBalance` answers "what should we
 * offer". Offering conservatively and then refusing what was offered would be
 * the worst of both.
 */
export type PayerFunds =
	{ok: true} | {ok: false; balance: bigint; required: bigint};

export function checkPayerFunds(params: {
	balance: bigint;
	value: bigint;
	maxFeePerGas: bigint;
	gas?: bigint;
}): PayerFunds {
	const {balance, value, maxFeePerGas, gas = TRANSFER_GAS} = params;
	const required = value + gas * maxFeePerGas;
	return balance >= required ? {ok: true} : {ok: false, balance, required};
}

/**
 * Render a wei value for display, rounded DOWN to a readable number of places.
 *
 * Down, always: a displayed figure that rounds up overstates what is about to
 * be sent, and the user then reads a number their payer cannot cover.
 *
 * NOT `formatBalance` from `core/utils/format`, deliberately, and this is the
 * only reason there are two formatters in `core/`. That one is built for
 * displaying a balance someone holds: it rounds to nearest, marking the result
 * `~` when it rounded up and `>` when it truncated. Both are wrong here. An
 * amount that reads higher than what is sent is a figure the payer cannot
 * cover, and a `~` or `>` in front of a number the user is about to confirm
 * says the app is unsure of what it is spending.
 */
export function formatAmount(
	value: bigint,
	decimals: number,
	places = 6,
): string {
	if (decimals <= places) return formatUnits(value, decimals);
	const factor = 10n ** BigInt(decimals - places);
	return formatUnits((value / factor) * factor, decimals);
}
