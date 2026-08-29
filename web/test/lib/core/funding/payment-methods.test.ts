import {describe, it, expect} from 'vitest';
import {availablePaymentMethods, paymentMethods} from '$lib/core/funding';

/**
 * Nothing on this branch imports `core/funding`; see the header of
 * `funding-math.test.ts` for why it is here and why it is tested anyway.
 *
 * These cases came up with the module from `with/local-signer`, where they
 * passed against the same assertions. The one that changed is the wallet veto,
 * which took the caller's wording rather than naming a delegation rule here:
 * that rename is step 3 of the cascade checklist in the directory's README.
 */

const both = {
	accountSpendable: 10n ** 18n,
	ownerCanSend: true,
	walletsAvailable: 1,
};

describe('paymentMethods: who can pay, as a set', () => {
	it('is a list, so a third option is an entry rather than a restructure', () => {
		// A card option is planned (with an emulated one for dev). What makes it
		// cheap to add is that the flow renders whatever this returns.
		expect(paymentMethods(both).map((m) => m.id)).toEqual([
			'account',
			'wallet',
		]);
	});

	it('offers the account first, because it is one transaction and no second connection', () => {
		expect(paymentMethods(both)[0].id).toBe('account');
	});

	it('refuses the account when it holds nothing to send', () => {
		const methods = paymentMethods({...both, accountSpendable: 0n});
		const account = methods.find((m) => m.id === 'account');
		expect(account?.available).toBe(false);
		expect(account?.unavailableReason).toBeTruthy();
	});

	it('refuses the account when it has no wallet to send with', () => {
		const account = paymentMethods({...both, ownerCanSend: false}).find(
			(m) => m.id === 'account',
		);
		expect(account?.available).toBe(false);
		expect(account?.unavailableReason).toMatch(/no wallet/);
	});

	it('refuses another wallet when the payment connection can see none', () => {
		// Read from the connection that will actually be used: it discovers
		// injected / EIP-6963 wallets, and has nothing to offer without one.
		const wallet = paymentMethods({...both, walletsAvailable: 0}).find(
			(m) => m.id === 'wallet',
		);
		expect(wallet?.available).toBe(false);
		expect(wallet?.unavailableReason).toMatch(/No wallet/);
	});

	it('refuses another wallet when the action itself vetoes that route', () => {
		const wallet = paymentMethods({
			...both,
			walletRouteBlocked: {
				reason:
					"You withdrew this browser's access before, and only your own account can authorise it again.",
			},
		}).find((m) => m.id === 'wallet');
		expect(wallet?.available).toBe(false);
		// The WORDING comes from the caller: what disqualifies a payer is a
		// property of the action, not of paying. See PaymentMethodsInput.
		expect(wallet?.unavailableReason).toMatch(/withdrew/);
	});

	it('always says WHY, so no button is ever disabled without a reason', () => {
		const methods = paymentMethods({
			accountSpendable: 0n,
			ownerCanSend: false,
			walletsAvailable: 0,
		});
		for (const method of methods) {
			expect(method.available).toBe(false);
			expect(method.unavailableReason).toBeTruthy();
		}
	});
});

describe('availablePaymentMethods: the empty set is a real answer', () => {
	it('is empty for an account with no wallet in a browser with no wallet', () => {
		// A hosted account here can currently do nothing: it cannot send, and there
		// is nothing to pay with. Reachable, and not a bug.
		expect(
			availablePaymentMethods(
				paymentMethods({
					accountSpendable: 0n,
					ownerCanSend: false,
					walletsAvailable: 0,
				}),
			),
		).toEqual([]);
	});

	it('keeps only what the user can act on', () => {
		expect(
			availablePaymentMethods(
				paymentMethods({...both, ownerCanSend: false}),
			).map((m) => m.id),
		).toEqual(['wallet']);
	});
});
