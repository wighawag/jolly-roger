import {describe, it, expect} from 'vitest';
import {deriveDelegationRow} from '$lib/ui/delegation/delegation-view';
import {isRegistered} from '$lib/onchain/delegation';

const OWNER = '0x00000000000000000000000000000000000000dD' as const;
const SIGNER = '0x00000000000000000000000000000000000000aA' as const;
const OTHER = '0x00000000000000000000000000000000000000cC' as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;

const registered = {
	step: 'Loaded' as const,
	delegate: SIGNER,
	withdrawn: false,
};
const none = {step: 'Loaded' as const, delegate: ZERO, withdrawn: false};
const unknown = {step: 'Unloaded' as const};

describe('isRegistered', () => {
	it('is true only for the signer the chain names', () => {
		expect(isRegistered(registered, SIGNER)).toBe(true);
		expect(isRegistered(registered, OTHER)).toBe(false);
		expect(isRegistered(none, SIGNER)).toBe(false);
	});

	it('ignores address casing, which the chain does not care about', () => {
		expect(
			isRegistered(
				{...registered, delegate: SIGNER.toLowerCase() as `0x${string}`},
				SIGNER,
			),
		).toBe(true);
	});

	it('reads an unknown answer as NOT registered', () => {
		// Guessing this way costs a prompt to register that turns out to be
		// unnecessary. Guessing the other way sends a transaction that reverts.
		expect(isRegistered(unknown, SIGNER)).toBe(false);
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
		});
		expect(view.authorised).toBe(false);
		expect(view.status).toMatch(/Checking/);
	});
});
