import {describe, it, expect} from 'vitest';
import {deriveDelegationRow} from '$lib/ui/delegation/delegation-view';
import {isRegistered} from '$lib/onchain/delegation';

const OWNER = '0x00000000000000000000000000000000000000dD' as const;
const SIGNER = '0x00000000000000000000000000000000000000aA' as const;

const registered = {
	step: 'Loaded' as const,
	allowed: true,
	withdrawn: false,
};
const none = {step: 'Loaded' as const, allowed: false, withdrawn: false};
const unknown = {step: 'Unloaded' as const};

// The app's answer to "what is this key for". Deliberately NOT the greeting
// demo's, so that a status line built from the template's sentence frames shows
// up here as the app's words rather than passing on a hard-coded default.
const GRANT = {action: 'feed the cat'} as const;

describe('isRegistered', () => {
	it('reads the answer the chain gave about THIS signer', () => {
		// A field, not an address comparison: `delegationStatus` was asked about
		// the (account, signer) pair, so there is no second address to check and no
		// casing to get wrong. An account may have several delegates now, so "the"
		// delegate is not a question with an answer.
		expect(isRegistered(registered)).toBe(true);
		expect(isRegistered(none)).toBe(false);
	});

	it('reads an unknown answer as NOT registered', () => {
		// Guessing this way costs a prompt to register that turns out to be
		// unnecessary. Guessing the other way sends a transaction that reverts.
		expect(isRegistered(unknown)).toBe(false);
	});
});

describe('deriveDelegationRow: what the account panel offers', () => {
	it('stays out of the DOM when there is no signer to authorise', () => {
		expect(
			deriveDelegationRow({
				owner: OWNER,
				signer: undefined,
				delegation: none,
				ownerCanSend: true,
				grant: GRANT,
			}).visible,
		).toBe(false);
	});

	it('offers withdrawal once this browser is authorised', () => {
		// An authorisation the user cannot withdraw is the failure the whole
		// mechanism exists to avoid, so it is reachable from the panel.
		const view = deriveDelegationRow({
			owner: OWNER,
			signer: SIGNER,
			delegation: registered,
			ownerCanSend: true,
			grant: GRANT,
		});
		expect(view.visible).toBe(true);
		expect(view.authorised).toBe(true);
		expect(view.canRevoke).toBe(true);
		expect(view.revokeBlockedReason).toBeUndefined();
	});

	it('disables withdrawal WITH A REASON for an account that cannot send', () => {
		// revokeDelegate is an owner-sent transaction, so an account with no wallet
		// cannot call it. Letting the click revert would be worse than saying so.
		const view = deriveDelegationRow({
			owner: OWNER,
			signer: SIGNER,
			delegation: registered,
			ownerCanSend: false,
			grant: GRANT,
		});
		expect(view.canRevoke).toBe(false);
		expect(view.revokeBlockedReason).toMatch(/no wallet/);
	});

	it('has nothing to withdraw when nothing was granted', () => {
		const view = deriveDelegationRow({
			owner: OWNER,
			signer: SIGNER,
			delegation: none,
			ownerCanSend: true,
			grant: GRANT,
		});
		expect(view.authorised).toBe(false);
		expect(view.canRevoke).toBe(false);
	});

	it('says it is still looking rather than claiming a state it does not know', () => {
		const view = deriveDelegationRow({
			owner: OWNER,
			signer: SIGNER,
			delegation: unknown,
			ownerCanSend: true,
			grant: GRANT,
		});
		expect(view.authorised).toBe(false);
		expect(view.status).toMatch(/Checking/);
	});

	// THE BUG THIS PINS: the three status lines were written out in
	// `delegation-view.ts` with the greeting demo's words in them, so every app
	// built on this template told its users that the key was for posting
	// greetings. Nobody noticed, because nobody reads the account panel of a
	// template's own demo. Asserting the app's phrase appears is what makes a
	// hard-coded sentence fail here rather than ship.
	it.each([
		['authorised', registered],
		['not yet authorised', none],
		['still loading', unknown],
	])("says what the key is for in the APP's words when %s", (_, delegation) => {
		const view = deriveDelegationRow({
			owner: OWNER,
			signer: SIGNER,
			delegation,
			ownerCanSend: true,
			grant: GRANT,
		});
		expect(view.status).toContain(GRANT.action);
		expect(view.status).not.toMatch(/greeting/i);
	});
});
