import {get} from 'svelte/store';
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

export type FundFromAccountDeps = Pick<Context, 'accountExecutor'>;

/**
 * Move gas to the signer from the account the user signed in with.
 *
 * The other half of "who pays": no second connection, no second wallet, one
 * prompt. Available only when that account has a wallet and holds enough, which
 * is decided before this is offered (see ui/credits/payment-methods).
 *
 * A plain transfer rather than a contract call, because the signer is already a
 * delegate by the time this path is taken - a signer that is NOT goes through
 * the registration instead, which carries the funding in the same transaction.
 */
export async function fundSignerFromAccount(
	deps: FundFromAccountDeps,
	params: {to: `0x${string}`; value: bigint},
): Promise<GetCreditsResult> {
	const $executor = get(deps.accountExecutor);
	if ($executor.status !== 'ready') {
		return {
			status: 'error',
			message: 'This account cannot send a transaction.',
			details: `account executor status: ${$executor.status}`,
		};
	}

	try {
		await $executor.client.sendTransaction({
			account: $executor.account,
			to: params.to,
			value: params.value,
			// Spelled out because only `writeContract` auto-populates it: a plain
			// transfer has no function name to read one from. Without it this
			// transfer would land in the user's operation list as an untitled entry.
			metadata: {type: 'unknown', name: 'topUp', data: []},
		});
		return {status: 'bought'};
	} catch (error) {
		if (isUserRejectionError(error)) return {status: 'cancelled'};
		console.error('Failed to fund the signer from your account:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}

export type FundPayerResult =
	| {
			status: 'funded';
			/**
			 * How much the faucet actually sent, when its transaction could be read.
			 *
			 * Carried back because it is worth more than the balance read that
			 * follows: an injected wallet answers `eth_getBalance` from a cache until
			 * it sees a new block, so asking it straight after a claim reports the
			 * balance from before the claim, and the flow then tells the user their
			 * freshly funded account is empty.
			 */
			dispensed?: bigint;
	  }
	| {status: 'cancelled'}
	| {status: 'error'; message: string; details: string};

export type FundAddressDeps = FaucetClaimDeps;

/**
 * Send the faucet at ONE NAMED ADDRESS.
 *
 * THE ADDRESS IS A PARAMETER, and that is the whole point. There used to be two
 * of these: one for the authenticated account, and one for "the payer" which
 * asked the payment connection afresh who that was. Either answer could differ
 * from the address the UI was naming, and then the faucet funded an account the
 * user was not looking at while the screen went on showing an empty one.
 *
 * Whoever is paying is always already known by the time a faucet is asked for,
 * so the caller passes it and there is nothing left to disagree about.
 *
 * RETURNS the outcome rather than throwing, and the caller must look at it. A
 * faucet refuses for ordinary reasons - one claim per address and per IP per
 * day, a recipient that already holds enough - and a caller that ignores this
 * goes on to tell the user the claim completed and then blames the balance for
 * being empty.
 */
export async function fundAddress(
	deps: FundAddressDeps,
	config: {faucetApi?: string; faucetLink: string},
	address: `0x${string}`,
): Promise<FundPayerResult> {
	try {
		const {dispensed} = await claimFaucet(deps, config, address);
		return {status: 'funded', dispensed};
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
