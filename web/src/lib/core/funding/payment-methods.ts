/**
 * Who pays, as an enumerable set rather than two hardcoded buttons.
 *
 * There are two ways to pay today and a third is planned (a card, with an
 * emulated one for development), so the shape here is a LIST with an
 * availability predicate per entry: adding one is another entry, not a
 * restructure of the flow that shows them. Deliberately not a plugin system -
 * the set is closed, declared in one place, and small.
 *
 * Availability is answered from what is actually there, never assumed:
 * - paying from the account needs the account to have a wallet AND to be able
 *   to cover the transaction plus whatever it forwards;
 * - paying with another wallet needs a wallet to exist to connect to, read from
 *   the payment connection's OWN wallet list, since that is the connection that
 *   will be used.
 *
 * BOTH CAN BE UNAVAILABLE. An account with no wallet, in a browser with no
 * wallet installed, can do nothing here: it cannot send, and there is nothing
 * to pay with. That is a real, reachable state, so it gets an honest
 * explanation rather than a disabled button with no reason (or a spinner).
 *
 * PURE, so the whole of "who can pay" is answered by stating three facts and
 * reading a list. A descendant that needs this answer should call it rather
 * than re-derive a "prefer the account, fall back to a wallet" rule, which is
 * the same rule with none of the reasons attached.
 */

export type PaymentMethodId = 'account' | 'wallet';

export type PaymentMethod = {
	id: PaymentMethodId;
	label: string;
	/** One line, in a player's terms, on what choosing this does. */
	description: string;
	available: boolean;
	/** Why not, when it is unavailable. Always set when `available` is false. */
	unavailableReason?: string;
};

export type PaymentMethodsInput = {
	/**
	 * What the authenticated account could send right now, after keeping back
	 * the gas of sending it. Zero when it holds nothing, cannot cover the fee, or
	 * has no wallet to send with at all.
	 *
	 * This is `spendableBalance` (or `offerAmount`) from `./funding-math`, not a
	 * raw balance: an account holding exactly the fee can send nothing.
	 */
	accountSpendable: bigint;
	/** Whether the account can submit a transaction (i.e. it has a wallet). */
	ownerCanSend: boolean;
	/** How many wallets the PAYMENT connection can see. */
	walletsAvailable: number;
	/**
	 * A veto on paying with another wallet, from whatever this payment ALSO has
	 * to accomplish.
	 *
	 * Some terminal actions can only be carried out by a particular payer, and
	 * then a third-party wallet is a route that would revert. The reason is
	 * supplied by the caller rather than named here, because what disqualifies a
	 * payer is a property of the action, not of paying: on `with/local-signer`
	 * this is an account that withdrew its authorisation for the signer, which
	 * only an owner-sent registration can clear.
	 *
	 * Saying so keeps the user from choosing a route that could only fail.
	 */
	walletRouteBlocked?: {reason: string};
};

const ACCOUNT_DESCRIPTION =
	'One transaction from the account you signed in with. No second wallet to connect.';
const WALLET_DESCRIPTION =
	'Connect any wallet and pay from it. It does not have to be the account you signed in with.';

export function paymentMethods(
	input: PaymentMethodsInput,
): readonly PaymentMethod[] {
	const {accountSpendable, ownerCanSend, walletsAvailable} = input;

	const accountAvailable = ownerCanSend && accountSpendable > 0n;
	const walletAvailable = walletsAvailable > 0 && !input.walletRouteBlocked;

	return [
		{
			id: 'account',
			label: 'Pay from your account',
			description: ACCOUNT_DESCRIPTION,
			available: accountAvailable,
			unavailableReason: accountAvailable
				? undefined
				: ownerCanSend
					? 'This account does not hold enough to cover it.'
					: 'This account has no wallet, so it cannot send a transaction.',
		},
		{
			id: 'wallet',
			label: 'Pay with another wallet',
			description: WALLET_DESCRIPTION,
			available: walletAvailable,
			unavailableReason: walletAvailable
				? undefined
				: input.walletRouteBlocked
					? input.walletRouteBlocked.reason
					: 'No wallet was found in this browser.',
		},
	];
}

/** The subset the user can actually act on. Empty is a real answer. */
export function availablePaymentMethods(
	methods: readonly PaymentMethod[],
): readonly PaymentMethod[] {
	return methods.filter((method) => method.available);
}

/**
 * What to tell a user with nothing to choose from.
 *
 * Worded so that adding the card option later turns this into an OFFER rather
 * than a dead end: the sentence that follows would name it, and everything
 * above stays true.
 */
export const NO_PAYMENT_METHOD_EXPLANATION =
	'There is no way to pay from this browser yet. Your account cannot send a transaction on its own, and no wallet is installed here to pay with. Opening this app in a browser with a wallet, or signing in with an account that has one, will let you continue.';
