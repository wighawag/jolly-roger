export {default as CreditsIndicator} from './CreditsIndicator.svelte';
export {default as SignerBalance} from './SignerBalance.svelte';
export {default as TopUpModal} from './TopUpModal.svelte';
export {
	createCreditsViewStore,
	deriveCreditsView,
	signerAccountOf,
	topUpActionLabel,
	topUpPurpose,
	type CreditsView,
	type CreditsViewStore,
} from './credits-view';
// What a payment is FOR, which the dialog is told rather than deciding. A
// descendant paying for something of its own builds one of these instead of
// building a second chooser dialog. See ./funding-purpose.ts.
export {authorisationPurpose, type FundingPurpose} from './funding-purpose';
export {
	getCredits,
	fundSignerFromAccount,
	type GetCreditsResult,
} from './get-credits';
// Who can pay is `core/funding`'s, not this directory's: it needs no signer and
// no notion of credits. Re-exported here so the components that render the
// choice keep one import, and so a descendant can see where it went.
export {
	availablePaymentMethods,
	paymentMethods,
	NO_PAYMENT_METHOD_EXPLANATION,
	type PaymentMethod,
	type PaymentMethodId,
} from '$lib/core/funding';
export {
	createTopUpFlow,
	formatAmount,
	maxTopUp,
	spendableBalance,
	topUpCeiling,
	REGISTRATION_GAS,
	type TopUpFlow,
	type TopUpState,
} from './top-up-flow';
