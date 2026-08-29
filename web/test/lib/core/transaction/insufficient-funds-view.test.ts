import {describe, it, expect} from 'vitest';
import {
	deriveInsufficientFundsView,
	type KnownPayer,
} from '../../../../src/lib/core/transaction/insufficient-funds-view';
import type {BalanceCheckState} from '../../../../src/lib/core/transaction/balance-check-store';

function insufficientState(
	overrides: Partial<Extract<BalanceCheckState, {step: 'insufficient'}>> = {},
): BalanceCheckState {
	return {
		step: 'insufficient',
		balanceStore: {} as any,
		sender: undefined,
		estimatedCost: 1000n,
		onContinue: () => {},
		onDismiss: () => {},
		isWaitingForBalanceUpdate: false,
		...overrides,
	};
}

const ACCOUNT = '0x0000000000000000000000000000000000000001' as const;
const SIGNER = '0x00000000000000000000000000000000000000aa' as const;
const WALLET = '0x00000000000000000000000000000000000000bb' as const;

/** The full set an app with a payment rail has. */
const ALL_PAYERS: readonly KnownPayer[] = [
	{kind: 'account', address: ACCOUNT},
	{kind: 'signer', address: SIGNER},
	{kind: 'rail', address: WALLET},
];

const EMPTY = {step: 'Loaded', value: 0n} as const;

describe('deriveInsufficientFundsView', () => {
	it('returns a neutral view for non-insufficient steps', () => {
		const view = deriveInsufficientFundsView({step: 'idle'}, null);
		expect(view.balanceStore).toBe(null);
		expect(view.displayBalance).toBe(0n);
		expect(view.hasSufficientFunds).toBe(false);
		expect(view.shortfall).toBe(0n);
		expect(view.isWaitingForBalanceUpdate).toBe(false);
		expect(view.payer.kind).toBe('unknown');
		expect(view.remedy).toEqual({kind: 'none'});
	});

	it('computes a shortfall when the balance is below the cost', () => {
		const view = deriveInsufficientFundsView(insufficientState(), {
			step: 'Loaded',
			value: 400n,
		});
		expect(view.displayBalance).toBe(400n);
		expect(view.hasSufficientFunds).toBe(false);
		expect(view.shortfall).toBe(600n);
	});

	it('reports sufficient funds and no shortfall once covered', () => {
		const view = deriveInsufficientFundsView(insufficientState(), {
			step: 'Loaded',
			value: 1000n,
		});
		expect(view.hasSufficientFunds).toBe(true);
		expect(view.shortfall).toBe(0n);
	});

	it('treats an unloaded balance as zero', () => {
		const view = deriveInsufficientFundsView(insufficientState(), {
			step: 'Loading',
		});
		expect(view.displayBalance).toBe(0n);
		expect(view.hasSufficientFunds).toBe(false);
		expect(view.shortfall).toBe(1000n);
	});

	it('surfaces the waiting-for-balance flag', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({isWaitingForBalanceUpdate: true}),
			null,
		);
		expect(view.isWaitingForBalanceUpdate).toBe(true);
	});
});

describe('which KIND of payer is short', () => {
	it('recognises the authenticated account', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: ACCOUNT}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.payer.kind).toBe('account');
	});

	it('recognises the local signer', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: SIGNER}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.payer.kind).toBe('signer');
	});

	it('recognises a wallet on the payment rail', () => {
		// THE BUG. A rail wallet is neither the account nor the signer, and under
		// the single `accountAddress === sender` comparison this replaces it fell
		// into the "not the account" branch, which MEANT the signer.
		const view = deriveInsufficientFundsView(
			insufficientState({sender: WALLET}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.payer.kind).toBe('rail');
	});

	it('says unknown rather than guessing, for a sender it cannot place', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: '0x00000000000000000000000000000000000000cc'}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.payer.kind).toBe('unknown');
		expect(view.remedy).toEqual({kind: 'none'});
	});

	it('says unknown when there is no sender at all', () => {
		const view = deriveInsufficientFundsView(insufficientState(), EMPTY, {
			payers: ALL_PAYERS,
			faucetConfigured: true,
		});
		expect(view.payer.kind).toBe('unknown');
		expect(view.remedy).toEqual({kind: 'none'});
	});

	it('does not match a payer whose address is not known yet', () => {
		// An unconnected rail is an absence, not a wildcard. Matching it would
		// name a wallet the user has not chosen.
		const view = deriveInsufficientFundsView(
			insufficientState({sender: WALLET}),
			EMPTY,
			{
				payers: [
					{kind: 'account', address: ACCOUNT},
					{kind: 'rail', address: undefined},
				],
				faucetConfigured: true,
			},
		);
		expect(view.payer.kind).toBe('unknown');
	});

	it('compares addresses case-insensitively', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: ACCOUNT.toUpperCase() as `0x${string}`}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.payer.kind).toBe('account');
	});

	it('classifies against only the payers the app actually has', () => {
		// The base template has one. A signer address is then simply not one of
		// this app's accounts, and must not be described as one.
		const view = deriveInsufficientFundsView(
			insufficientState({sender: SIGNER}),
			EMPTY,
			{payers: [{kind: 'account', address: ACCOUNT}], faucetConfigured: true},
		);
		expect(view.payer.kind).toBe('unknown');
	});
});

describe('exactly one remedy, and it is the one that can work', () => {
	it('faucets the authenticated account when that is what is short', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: ACCOUNT}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.remedy).toEqual({kind: 'faucet', target: ACCOUNT});
	});

	it('offers a top-up, never the faucet, when the local signer is short', () => {
		// The original bug this file was written for: the faucet funds the user's
		// own account, the modal decides funding is on its way, and the
		// transaction fails for exactly the reason it already failed.
		const view = deriveInsufficientFundsView(
			insufficientState({sender: SIGNER}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.remedy).toEqual({kind: 'top-up'});
	});

	it('faucets THE WALLET THAT IS SHORT when a rail payer is short', () => {
		// The second bug. This used to be a top-up, which funds the local signer:
		// the wallet the user picked was never touched, and the transaction failed
		// anyway. The faucet has always taken a target; nothing but the address
		// comparison stopped it being used.
		const view = deriveInsufficientFundsView(
			insufficientState({sender: WALLET}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: true},
		);
		expect(view.remedy).toEqual({kind: 'faucet', target: WALLET});
	});

	it('never aims the faucet at the account when another payer is short', () => {
		for (const sender of [SIGNER, WALLET]) {
			const view = deriveInsufficientFundsView(
				insufficientState({sender}),
				EMPTY,
				{payers: ALL_PAYERS, faucetConfigured: true},
			);
			if (view.remedy.kind === 'faucet') {
				expect(view.remedy.target).not.toBe(ACCOUNT);
			}
		}
	});

	it('offers nothing rather than a faucet that is not configured', () => {
		for (const sender of [ACCOUNT, WALLET]) {
			const view = deriveInsufficientFundsView(
				insufficientState({sender}),
				EMPTY,
				{payers: ALL_PAYERS, faucetConfigured: false},
			);
			expect(view.remedy).toEqual({kind: 'none'});
		}
	});

	it('still offers the top-up with no faucet configured', () => {
		// The top-up is a purchase through the payment rail, so it does not depend
		// on there being a faucet at all.
		const view = deriveInsufficientFundsView(
			insufficientState({sender: SIGNER}),
			EMPTY,
			{payers: ALL_PAYERS, faucetConfigured: false},
		);
		expect(view.remedy).toEqual({kind: 'top-up'});
	});
});

describe('the wording names the account that is actually short', () => {
	const explanationFor = (sender: `0x${string}` | undefined) =>
		deriveInsufficientFundsView(insufficientState({sender}), EMPTY, {
			payers: ALL_PAYERS,
			faucetConfigured: true,
		}).payer;

	it('says "your balance" only for the account the user signed in with', () => {
		expect(explanationFor(ACCOUNT).balanceLabel).toBe('Your balance:');
		expect(explanationFor(SIGNER).balanceLabel).not.toBe('Your balance:');
		expect(explanationFor(WALLET).balanceLabel).not.toBe('Your balance:');
	});

	it('calls the signer the in-app spending account, and says it is separate', () => {
		const payer = explanationFor(SIGNER);
		expect(payer.balanceLabel).toBe('In-app balance:');
		expect(payer.explanation).toContain('in-app spending account');
		expect(payer.explanation).toContain('separate from the account you signed');
	});

	it('calls a rail payer the wallet the user chose, not the in-app balance', () => {
		// The contradiction being fixed: this said "your in-app spending account"
		// about a MetaMask account the user had just picked by hand, next to a
		// balance of 0 and a shortfall of the full price.
		const payer = explanationFor(WALLET);
		expect(payer.explanation).toContain('wallet you chose to pay with');
		expect(payer.explanation).not.toContain('in-app spending account');
		expect(payer.balanceLabel).toBe('Wallet balance:');
	});

	it('shows the address for the payer the user picked, and not for the others', () => {
		// The rail wallet is one of several accounts in their wallet, so which one
		// is both in doubt and checkable. The other two involved no choice.
		expect(explanationFor(WALLET).showAddress).toBe(true);
		expect(explanationFor(WALLET).address).toBe(WALLET);
		expect(explanationFor(ACCOUNT).showAddress).toBe(false);
		expect(explanationFor(SIGNER).showAddress).toBe(false);
	});

	it('never claims to know which account it is when it does not', () => {
		const payer = explanationFor('0x00000000000000000000000000000000000000cc');
		expect(payer.explanation).not.toContain('in-app');
		expect(payer.explanation).not.toContain('signed in');
		expect(payer.explanation).not.toContain('wallet you chose');
	});
});
