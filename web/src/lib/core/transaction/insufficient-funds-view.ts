import type {BalanceCheckState} from './balance-check-store';
import type {BalanceStore} from '$lib/core/connection/balance';

export type InsufficientFundsView = {
	/** The balance store to display (only present in the insufficient step). */
	balanceStore: BalanceStore | null;
	/** Live balance, defaulting to 0 while unloaded. */
	displayBalance: bigint;
	/** True once the (possibly updated) balance covers the estimated cost. */
	hasSufficientFunds: boolean;
	/** Missing amount, clamped to 0 when funds are sufficient. */
	shortfall: bigint;
	/** True while polling for a balance change after a faucet claim. */
	isWaitingForBalanceUpdate: boolean;
	/**
	 * Whether the faucet can actually fix THIS shortfall.
	 *
	 * The faucet funds one specific account: the one the user authenticated as.
	 * A transaction sent by the local signer is short on a different account, so
	 * offering the faucet there would be worse than offering nothing. It appears
	 * to work, tops up an account nobody was waiting on, and the transaction then
	 * fails anyway - which is exactly what it did before this existed.
	 */
	canUseFaucet: boolean;
	/**
	 * Whether the account that is short is NOT the one the user signed in as.
	 *
	 * Without this the modal says "your balance: 0" to somebody looking at a
	 * funded account, because the empty one is the in-app signer they were never
	 * told about. Naming it is the difference between an explanation and a
	 * contradiction.
	 */
	sentFromAnotherAccount: boolean;
};

type LoadedBalance = {step: 'Loaded'; value: bigint};

/**
 * Derive the display view-model for the insufficient-funds modal from the
 * balance-check state and the current value of its balance store.
 *
 * Pure: the `.svelte` file subscribes to the stores and passes their snapshots
 * here, keeping the balance math out of the component.
 */
export function deriveInsufficientFundsView(
	state: BalanceCheckState,
	currentBalance: {step: string; value?: bigint} | null,
	/** The address the user signed in as, when known. */
	accountAddress?: `0x${string}`,
	/** Whether a faucet is configured at all (it always funds `accountAddress`). */
	faucetConfigured = false,
): InsufficientFundsView {
	if (state.step !== 'insufficient') {
		return {
			balanceStore: null,
			displayBalance: 0n,
			hasSufficientFunds: false,
			shortfall: 0n,
			isWaitingForBalanceUpdate: false,
			canUseFaucet: false,
			sentFromAnotherAccount: false,
		};
	}

	const isAccount =
		!!accountAddress &&
		!!state.sender &&
		accountAddress.toLowerCase() === state.sender.toLowerCase();

	const loaded =
		currentBalance && currentBalance.step === 'Loaded'
			? (currentBalance as LoadedBalance)
			: null;
	const displayBalance = loaded ? loaded.value : 0n;
	const hasSufficientFunds = loaded
		? loaded.value >= state.estimatedCost
		: false;
	const shortfall =
		state.estimatedCost > displayBalance
			? state.estimatedCost - displayBalance
			: 0n;

	return {
		balanceStore: state.balanceStore,
		displayBalance,
		hasSufficientFunds,
		shortfall,
		isWaitingForBalanceUpdate: state.isWaitingForBalanceUpdate === true,
		canUseFaucet: faucetConfigured && isAccount,
		sentFromAnotherAccount: !!state.sender && !isAccount,
	};
}
