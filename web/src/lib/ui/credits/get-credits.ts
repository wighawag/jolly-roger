import {isUserRejectionError} from '$lib/core/transaction';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import {
	claimFaucet,
	type FaucetClaimDeps,
} from '$lib/core/ui/faucet/faucet-actions';
import type {Context} from '$lib/context/types';

/** Gas a plain native transfer costs; this template's top-up is exactly that. */
export const TRANSFER_GAS = 21_000n;

export type PayerFunds =
	{ok: true} | {ok: false; balance: bigint; required: bigint};

/**
 * Can the payer actually afford this top-up, gas included?
 *
 * Checked BEFORE the transaction reaches the wallet. Without it the wallet is
 * the thing that discovers the shortfall, and it reports it in its own words,
 * in a popup the user has to dismiss, about a number they cannot see. Asking
 * the chain first turns that into an ordinary form error next to the field they
 * typed in.
 *
 * Gas is included rather than compared against `value` alone: sending exactly
 * the balance always fails, and failing at the wallet for a reason the app
 * could have predicted is the case this exists to remove.
 */
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

export type GetCreditsResult =
	| {status: 'bought'}
	/** The payer cannot cover it. Correctable, so not an `error`. */
	| {status: 'insufficient'; balance: bigint; required: bigint}
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
 * need not be the player (see core/connection/remote). Its connect flow renders
 * through the second `ConnectionFlow` in context/AcrossPages, without which any
 * step needing the user (choosing between two installed wallets, say) would
 * hang with nothing on screen.
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
		// The payer's wallet IS remembered, deliberately: a player who tops up
		// twice should not have to pick their wallet again. It is remembered under
		// the payment connection's own storage prefix, so it cannot be mistaken for
		// the account the player signed in with (see core/connection/remote).
		const $payment = await payment.connection.ensureConnected();

		// Ask the chain before asking the wallet. See checkPayerFunds.
		const from = $payment.account.address;
		const [balance, maxFeePerGas] = await Promise.all([
			payment.publicClient.getBalance({address: from}),
			payment.publicClient.getGasPrice(),
		]);
		const funds = checkPayerFunds({balance, value, maxFeePerGas});
		if (!funds.ok) {
			return {
				status: 'insufficient',
				balance: funds.balance,
				required: funds.required,
			};
		}

		await payment.walletClient.sendTransaction({account: from, to, value});

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

export type FundPayerResult =
	| {status: 'funded'}
	| {status: 'cancelled'}
	| {status: 'error'; message: string; details: string};

export type FundPayerDeps = FaucetClaimDeps & Pick<Context, 'payment'>;

/**
 * Send the faucet at the account that PAYS for credits.
 *
 * Buying credits spends the payer's money, and on a local chain the payer is a
 * fresh account with none: the purchase then fails for a reason the user cannot
 * do anything about from inside the app. This funds it, and deliberately funds
 * only it - the purchase itself still runs, so the flow being exercised is the
 * real one rather than a shortcut around it.
 *
 * Connects the payment rail first, because the payer's address is not known
 * before that: which account pays is a choice made in the wallet, at the moment
 * of paying. That connect is the same one the purchase would trigger, so doing
 * it here costs the user nothing extra.
 */
export async function fundPayer(
	deps: FundPayerDeps,
	config: {faucetApi?: string; faucetLink: string},
): Promise<FundPayerResult> {
	try {
		const $payment = await deps.payment.connection.ensureConnected();
		await claimFaucet(deps, config, $payment.account.address);
		return {status: 'funded'};
	} catch (error) {
		if (isUserRejectionError(error)) return {status: 'cancelled'};
		console.error('Failed to fund the paying account:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
