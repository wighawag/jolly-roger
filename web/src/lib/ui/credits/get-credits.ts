import {parseUnits} from 'viem';
import {isUserRejectionError} from '$lib/core/transaction';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import {topUpAmount, type CreditsConfig} from '$lib/core/connection/credits';
import type {Context} from '$lib/context/types';

export type TopUpAmount =
	{ok: true; value: bigint} | {ok: false; error: string};

/**
 * How much one top-up sends.
 *
 * With a credit unit the price is fixed and the user is never asked: a credit
 * is a defined thing, so "get 100 credits" costs what 100 credits cost.
 * Without one there is no unit to price anything in, so the amount has to come
 * from the user, and is validated as a native-currency figure.
 */
export function resolveTopUpAmount(
	credits: CreditsConfig | undefined,
	input: string,
	decimals: number = 18,
): TopUpAmount {
	if (credits) return {ok: true, value: topUpAmount(credits)};

	const trimmed = input.trim();
	if (!trimmed) return {ok: false, error: 'Enter an amount'};

	let value: bigint;
	try {
		value = parseUnits(trimmed, decimals);
	} catch {
		return {ok: false, error: 'Not a valid amount'};
	}
	// parseUnits throws on anything that is not a plain decimal, but happily
	// returns a signed or zero result, and silently truncates below the
	// currency's smallest unit ('0.0000000000000000001' becomes 0 wei). All three
	// would broadcast a transfer of nothing, so they are rejected here rather
	// than surfacing later as a transaction that changed no balance.
	if (value <= 0n) return {ok: false, error: 'Enter an amount above zero'};
	return {ok: true, value};
}

export type GetCreditsResult =
	| {status: 'bought'}
	| {status: 'cancelled'}
	| {status: 'error'; message: string; details: string};

export type GetCreditsDeps = Pick<Context, 'payment' | 'signerBalance'>;

/**
 * Buy credits for the signer: connect a paying wallet and send it the gas.
 *
 * THE SEAM. In a real game this is one call to the game's own sale contract,
 * which takes the payment for whatever the player is buying AND carries the
 * signer's gas along in the same `msg.value` - see bomber-world's
 * `SaleViaNativePayment.purchase(to, subID, data, extraNativeTokenRecipient,
 * extraNativeTokenAmount, referrer)`, where `extraNativeTokenRecipient` is the
 * signer and the remainder of `msg.value` is the item's price. One transaction,
 * one confirmation: the player buys in, and the signer comes out funded.
 *
 * This template has nothing to sell, so what is left of that call is the gas
 * transfer alone. Replacing this function body with a `writeContract` against a
 * sale contract is the whole of what a game has to change; everything around it
 * (the payment connection, the credit denomination, the empty-signer prompt)
 * already assumes a purchase rather than a faucet.
 *
 * Sent from the PAYMENT connection, not from the app's connection: the payer
 * need not be the player (see core/connection/remote). Asking for the rail here
 * is also what BUILDS it, on the first purchase of the session.
 *
 * Outcomes are normalised the way `setGreeting` does, so the component only
 * renders: `cancelled` (rejected in-wallet, nothing to report), `error` (a real
 * failure, with text), `bought`.
 */
export async function getCredits(
	deps: GetCreditsDeps,
	params: {to: `0x${string}`; value: bigint},
): Promise<GetCreditsResult> {
	const {payment, signerBalance} = deps;
	const {to, value} = params;

	try {
		const rail = payment.get();

		// The payer's wallet IS remembered, deliberately: a player who tops up
		// twice should not have to pick their wallet again. It is remembered under
		// the payment connection's own storage prefix, so it cannot be mistaken for
		// the account the player signed in with (see core/connection/remote).
		const $payment = await rail.connection.ensureConnected();

		await rail.walletClient.sendTransaction({
			account: $payment.account.address,
			to,
			value,
		});

		// The signer's balance is what the user is watching, so refresh it now
		// rather than waiting up to a full poll interval. Fire-and-forget: the
		// payment already went through, and a failed refresh is just a stale
		// number that the next poll corrects.
		void signerBalance.update();

		return {status: 'bought'};
	} catch (error) {
		if (isUserRejectionError(error)) return {status: 'cancelled'};
		console.error('Failed to buy credits:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
