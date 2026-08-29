import {keyExplanation, type SignerGrant} from '$lib/ui/delegation/grant';

/**
 * WHY THE USER IS BEING ASKED TO PAY, supplied by whoever asked.
 *
 * The payment dialog's real job is to ask ONE question: pay from the account
 * you signed in with, or with another wallet (and later, with a card). That
 * question is the same every time, which is what makes the dialog reusable.
 * What the money is FOR is not the same every time, and the dialog cannot know
 * it, so it is passed in.
 *
 * IT USED TO GUESS. The title branched on `registering`, a flag that means
 * "this payment also authorises the browser" and was being read as "this
 * payment is an onboarding", which is one caller's purpose rather than a
 * description of any. A descendant needing to take a payment for a third
 * reason (selling an avatar) had no way to say so, so it built a second
 * chooser dialog that differed from this one in its title and one line of
 * explanation, and duplicated the method list, its ordering and its rules to
 * get them. A purpose is what that descendant was missing.
 *
 * MODELLED ON `ConfirmationRequest` (`core/ui/confirm/confirmation.ts`), which
 * solved the same problem for the same reason: "who asks supplies the words,
 * one modal renders whatever is pending". This is that arrangement for a
 * payment instead of a question.
 *
 * WHAT DOES NOT BELONG HERE. Anything the flow discovers for itself: which
 * methods exist, what it will cost, who the payer is, whether a signature is
 * coming. A purpose is the words around the question, never an instruction
 * about how to answer it.
 */
export type FundingPurpose = {
	/** Headline: what this payment is for, in the user's terms. */
	headline: string;
	/**
	 * One line under it: what paying actually does.
	 *
	 * A whole sentence, because it is read on its own before any figure is on
	 * screen. This is the only place that says why money is being asked for at
	 * all, so a purpose without a usable explanation makes the dialog an amount
	 * with no reason attached.
	 */
	explanation: string;
	/**
	 * Which icon sits next to the headline. Defaults to `coins`.
	 *
	 * A NAME rather than a component, so a purpose stays plain data and can be
	 * built in a `.ts` module (see AGENTS.md: logic lives in `.ts`). The modal
	 * maps the name to a component, which is presentation and therefore its
	 * business.
	 */
	icon?: 'coins' | 'key';
};

/**
 * The purpose for a payment whose point IS authorising this browser.
 *
 * Built from the app's grant so that the headline the user reads here and the
 * consent list they read before signing cannot describe two different keys.
 *
 * Note that this is only the purpose for a caller that set out to register (the
 * delegation gate). Any OTHER caller can also end up registering, because the
 * flow reads the chain and discovers it: a user who presses "Top up" with an
 * unregistered signer keeps their own purpose and is shown the consent step on
 * top of it. Which is why the consent copy is configured on the flow rather
 * than carried in a purpose that only one caller would supply.
 */
export function authorisationPurpose(grant: SignerGrant): FundingPurpose {
	return {
		headline: 'Let this browser play for you',
		explanation: keyExplanation(grant),
		icon: 'key',
	};
}
