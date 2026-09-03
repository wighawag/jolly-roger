import type {AddressUnavailable} from '@etherplay/connect';
import {shortAddress} from '$lib/core/utils/ethereum/address';

/**
 * What to tell the user when the wallet cannot act as the account the app asked
 * for.
 *
 * NOT AN ERROR, AND IT MUST NOT BE DRESSED AS ONE. Nothing failed: the wallet is
 * working, the user is connected, and they are simply on a different account
 * than the one this particular action needs. @etherplay/connect 0.12.0 rests
 * this on `connection.addressUnavailable` instead of throwing, precisely so the
 * app can say which account to switch to rather than reporting a failure the
 * user cannot act on.
 *
 * There are exactly two ways out and the UI owes the user both: switch account
 * in the wallet, at which point the pending request proceeds on its own with
 * nothing to press here, or dismiss, which the library treats as a cancellation.
 *
 * WHY NOT JUST RENDER `state.message`. The library ships a complete sentence,
 * and says why it is not the final word: it does not shorten addresses, because
 * how to abbreviate one is the app's decision. This app shortens them
 * everywhere (see `shortAddress`), and it also splits the case the single
 * sentence cannot: a wallet offering NO account is locked, and telling someone
 * to switch account in a wallet they cannot see into is an instruction they
 * cannot follow. Both are exactly the app-side decisions that field is
 * documented to leave open, and every value needed to make them is on the
 * object.
 *
 * Pure, so the wording can be argued with in tests rather than by getting a
 * wallet into this state by hand.
 */
export type AddressUnavailableView = {
	title: string;
	/** The instruction, naming the account to switch to and the wallet if known. */
	message: string;
	/**
	 * What the wallet is offering instead, as a sentence rather than a list.
	 * Undefined when the wallet offers nothing, which is what a LOCKED wallet
	 * reports: `selected` goes absent as the wallet moves.
	 */
	detail?: string;
};

/**
 * Describe a resting `addressUnavailable`, or undefined when there is none.
 *
 * `available` IS DELIBERATELY NOT OFFERED AS A CHOICE. It is what the wallet is
 * exposing, not what the user owns: MetaMask lists every permitted account while
 * Rabby lists only the one it is on, so it is routinely a single entry that does
 * not include the requested address WHILE THE USER IS HOLDING IT. Rendering it
 * as a picker would therefore tell a Rabby user their account does not exist,
 * and picking from it would abandon the request and settle it as a cancellation,
 * which is not what someone reaches for a list of their own accounts to do.
 */
export function addressUnavailableView(
	state: AddressUnavailable | undefined,
): AddressUnavailableView | undefined {
	if (!state) return undefined;

	const wallet = state.walletName ?? 'your wallet';
	const wanted = shortAddress(state.requested);

	// A wallet offering NO account is a locked one, and telling a user to switch
	// account in a wallet they cannot see into is useless. Unlocking is the step
	// they can actually take.
	if (!state.selected) {
		return {
			title: 'Unlock your wallet',
			message:
				`This action has to come from ${wanted}, and ${wallet} is not ` +
				`offering any account right now. Unlock it and select ${wanted}.`,
		};
	}

	return {
		title: 'Switch account',
		message:
			`This action has to come from ${wanted}. Switch ${wallet} to that ` +
			`account and it will carry on by itself.`,
		detail: `${wallet} is currently on ${shortAddress(state.selected)}.`,
	};
}
