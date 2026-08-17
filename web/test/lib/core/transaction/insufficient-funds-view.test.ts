import {describe, it, expect} from 'vitest';
import {deriveInsufficientFundsView} from '../../../../src/lib/core/transaction/insufficient-funds-view';
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

describe('deriveInsufficientFundsView', () => {
	it('returns a neutral view for non-insufficient steps', () => {
		const view = deriveInsufficientFundsView({step: 'idle'}, null);
		expect(view).toEqual({
			balanceStore: null,
			displayBalance: 0n,
			hasSufficientFunds: false,
			shortfall: 0n,
			isWaitingForBalanceUpdate: false,
			canUseFaucet: false,
			sentFromAnotherAccount: false,
			canTopUp: false,
		});
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

describe('deriveInsufficientFundsView: whether the faucet can help', () => {
	const ACCOUNT = '0x0000000000000000000000000000000000000001' as const;
	const SIGNER = '0x00000000000000000000000000000000000000aa' as const;

	it('offers the faucet when the account it funds is the one that is short', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: ACCOUNT}),
			{step: 'Loaded', value: 0n},
			ACCOUNT,
			true,
		);
		expect(view.canUseFaucet).toBe(true);
		expect(view.sentFromAnotherAccount).toBe(false);
	});

	it('does NOT offer it when a different account is short', () => {
		// The bug this prevents: a transaction sent by the local signer runs out
		// of gas, the modal offers a faucet, the faucet tops up the user's OWN
		// account instead, the modal decides funding is on its way and lets the
		// user continue, and the transaction fails for exactly the original
		// reason. Everything appeared to work.
		const view = deriveInsufficientFundsView(
			insufficientState({sender: SIGNER}),
			{step: 'Loaded', value: 0n},
			ACCOUNT,
			true,
		);
		expect(view.canUseFaucet).toBe(false);
		// And the modal must SAY so, or "your balance: 0" contradicts the funded
		// account the user is looking at.
		expect(view.sentFromAnotherAccount).toBe(true);
	});

	it('does not offer it with no faucet configured', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: ACCOUNT}),
			{step: 'Loaded', value: 0n},
			ACCOUNT,
			false,
		);
		expect(view.canUseFaucet).toBe(false);
	});

	it('compares addresses case-insensitively', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: ACCOUNT.toUpperCase() as `0x${string}`}),
			{step: 'Loaded', value: 0n},
			ACCOUNT,
			true,
		);
		expect(view.canUseFaucet).toBe(true);
		expect(view.sentFromAnotherAccount).toBe(false);
	});

	it('does not offer it when the sender is unknown', () => {
		const view = deriveInsufficientFundsView(
			insufficientState({sender: undefined}),
			{step: 'Loaded', value: 0n},
			ACCOUNT,
			true,
		);
		expect(view.canUseFaucet).toBe(false);
		expect(view.sentFromAnotherAccount).toBe(false);
	});
});
