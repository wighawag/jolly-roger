export {default as DelegationRow} from './DelegationRow.svelte';
export {
	createDelegationCheckStore,
	NotRegisteredError,
	type DelegationCheckState,
	type DelegationCheckStore,
} from './delegation-check';
export {
	createDelegationRowStore,
	deriveDelegationRow,
	type DelegationRowView,
	type DelegationRowStore,
} from './delegation-view';
export {
	chooseRegistrationRoute,
	credentialExpired,
	credentialState,
	reauthoriseExplanation,
	registrationRequest,
	sameAddress,
	type CredentialState,
	type DelegationTarget,
	type RegistrationRequest,
	type RegistrationRoute,
} from './registration';
export {
	delegationAccountOf,
	isCredentialRejection,
	fetchDelegation,
	submitRegistration,
	type DelegationAccount,
	type RegisterResult,
} from './register-delegate';
export {revokeDelegation, type RevokeResult} from './revoke';
// What the browser's key may do, in the app's own words. The one piece of this
// copy an app has to supply; everything around it is the template's.
export {
	consentBullets,
	grantStatus,
	keyExplanation,
	type SignerGrant,
} from './grant';
