import {get} from 'svelte/store';
import type {GasPrice} from '$lib/core/connection/gasFee';
import type {
	ExtendedTransactionMetadata,
	OnchainOperation,
} from '$lib/account/AccountData';
import {InsufficientFundsError} from '$lib/core/transaction';
import type {Context} from '$lib/context/types';
import type {ExecutorStore} from '$lib/core/connection/executor';
import type {BalanceStore} from '$lib/core/connection/balance';

/**
 * An account that can send, paired with the balance it spends.
 *
 * Kept together because a replacement needs both and they must agree: pick the
 * executor by `from`, then measure affordability against THAT account, not
 * against whichever balance happened to be to hand.
 */
type Sender = {executor: ExecutorStore; balance: BalanceStore};

/** The accounts this app can send from, each with the balance it spends. */
function senders(deps: {
	accountExecutor: ExecutorStore;
	signerExecutor: ExecutorStore;
	accountBalance: BalanceStore;
	signerBalance: BalanceStore;
}): readonly Sender[] {
	return [
		{executor: deps.accountExecutor, balance: deps.accountBalance},
		{executor: deps.signerExecutor, balance: deps.signerBalance},
	];
}
import type {ExecutorState} from '$lib/core/connection/executor';

type GasParameters = {
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	gasPrice?: bigint;
};

/**
 * Extract the minimum gas price (the previous tx's fee) from an operation's
 * tracked-transaction metadata, used to validate a resubmit. Returns undefined
 * when the operation lacks gas parameters.
 */
export function deriveMinGasPrice(
	operation: OnchainOperation | null,
): GasPrice | undefined {
	if (!operation) return undefined;
	const gasParams = operation.metadata.tx.gasParameters as GasParameters;

	const maxFeePerGas = gasParams?.maxFeePerGas ?? gasParams?.gasPrice;
	const maxPriorityFeePerGas =
		gasParams?.maxPriorityFeePerGas ?? gasParams?.gasPrice;

	if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) {
		return undefined;
	}
	return {maxFeePerGas, maxPriorityFeePerGas};
}

/**
 * The gas price to use when cancelling: the higher of the original fee + 1 wei
 * and the current network "fast" fee, so the cancel strictly replaces the
 * pending tx.
 */
export function deriveCancelGasPrice(
	originalGasParameters: GasParameters | undefined,
	fastPrice: bigint,
): bigint {
	const originalGasPrice =
		originalGasParameters?.maxFeePerGas ??
		originalGasParameters?.gasPrice ??
		0n;
	return originalGasPrice >= fastPrice ? originalGasPrice + 1n : fastPrice;
}

/**
 * Map a resubmit/cancel failure to a user-facing message. Returns null when the
 * error is an insufficient-funds dismissal (which should be silently ignored).
 */
export function toReplacementErrorMessage(
	err: unknown,
	fallback: string,
): string | null {
	if (err instanceof InsufficientFundsError) {
		// User dismissed the funds modal - silently cancel.
		return null;
	}
	const error = err as {code?: number; message?: string};
	if (error.code === 4001) {
		return 'Transaction rejected by user';
	}
	if (error.message?.includes('nonce')) {
		return 'Nonce conflict - transaction may have already been processed';
	}
	return error.message || fallback;
}

export type ReplacementResult =
	| {status: 'submitted'}
	| {status: 'cancelled'}
	/**
	 * The current executor account differs from the account that sent the
	 * original tx. Replacements reuse the original nonce, and nonces are
	 * per-account, so sending from another account would not replace anything.
	 */
	| {status: 'wrong-account'; expected: `0x${string}`}
	| {status: 'error'; message: string};

/** User-facing explanation for the `wrong-account` replacement result. */
export function wrongAccountMessage(expected: `0x${string}`): string {
	return (
		'This transaction was sent from a different account ' +
		`(${expected.slice(0, 6)}…${expected.slice(-4)}). ` +
		'Reconnect with that account to replace or cancel it.'
	);
}

/**
 * A replacement (resubmit/cancel) must be sent from the same account as the
 * original tx, so this SELECTS the executor whose address matches, rather than
 * checking one and hoping. Returns the ready executor, or a ReplacementResult
 * to bail out with.
 *
 * Selecting matters now that more than one account can send. A transaction the
 * signer made and one the user made sit in the same list, and the button that
 * replaces either of them has to reach for the key that signed THAT one:
 * replacements reuse the original nonce, nonces are per-account, and sending
 * from the other account would broadcast a new transaction instead of
 * replacing anything. `from` is the discriminator, which is also what the UI
 * filters on, so there is one notion of "whose transaction is this".
 *
 * A not-ready executor is reported as an `error` (not `cancelled`): the user
 * explicitly clicked resubmit/cancel, so silently doing nothing would look
 * like a dead button. `cancelled` stays reserved for deliberate dismissal.
 */
function selectExecutorForSender(
	senders: readonly Sender[],
	originalFrom: `0x${string}`,
):
	| {
			ok: true;
			executor: Extract<ExecutorState, {status: 'ready'}>;
			balance: BalanceStore;
	  }
	| {ok: false; result: ReplacementResult} {
	const from = originalFrom.toLowerCase();
	const states = senders.map((sender) => ({
		state: get(sender.executor),
		balance: sender.balance,
	}));

	for (const {state, balance} of states) {
		if (state.status === 'ready' && state.address.toLowerCase() === from) {
			return {ok: true, executor: state, balance};
		}
	}

	// Nothing matched. Distinguish "no account is usable at all" from "the
	// account that sent this one is not the one connected now", because the user
	// can act on the second and not on the first.
	if (!states.some(({state}) => state.status === 'ready')) {
		return {
			ok: false,
			result: {
				status: 'error',
				message:
					'No account is ready to send transactions. Reconnect your wallet and try again.',
			},
		};
	}
	return {
		ok: false,
		result: {status: 'wrong-account', expected: originalFrom},
	};
}

type ResubmitDeps = Pick<
	Context,
	| 'accountExecutor'
	| 'signerExecutor'
	| 'accountBalance'
	| 'signerBalance'
	| 'deployments'
	| 'balanceCheck'
>;

/**
 * Resubmit a stuck operation with a new gas price, reusing the original nonce
 * and linking the new attempt to the existing operation.
 */
export async function resubmitOperation(
	deps: ResubmitDeps,
	params: {
		operation: OnchainOperation;
		operationKey: string;
		gasPrice: GasPrice;
	},
): Promise<ReplacementResult> {
	const {deployments, balanceCheck} = deps;
	const {operation, operationKey, gasPrice} = params;
	const $deployments = get(deployments);
	const originalTx = operation.metadata.tx;

	const guarded = selectExecutorForSender(senders(deps), originalTx.from);
	if (!guarded.ok) return guarded.result;
	const $executor = guarded.executor;

	try {
		const txRequest = await balanceCheck.ensureCanAfford(
			{
				transaction: {
					account: $executor.account,
					to: originalTx.to as `0x${string}`,
					data: originalTx.data,
					value: originalTx.value,
				},
			},
			{balance: guarded.balance, sender: $executor.address},
		);

		// operationId links this resubmit to the existing operation.
		const resubmitMetadata: ExtendedTransactionMetadata = {
			type: 'unknown',
			name: 'Resubmit Transaction',
			data: [],
			operationId: operationKey,
		};

		if (originalTx.chainId && originalTx.chainId !== $deployments.chain.id) {
			throw new Error(
				`tx to resubmit is from a different chain (${originalTx.chainId}) than the current (${$deployments.chain.id})`,
			);
		}

		await $executor.client.sendTransaction({
			...txRequest,
			chain: $deployments.chain,
			nonce: originalTx.nonce,
			maxFeePerGas: gasPrice.maxFeePerGas,
			maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
			metadata: resubmitMetadata,
		});

		return {status: 'submitted'};
	} catch (err) {
		const message = toReplacementErrorMessage(
			err,
			'Failed to resubmit transaction',
		);
		if (message === null) return {status: 'cancelled'};
		console.error(message);
		return {status: 'error', message};
	}
}

type CancelDeps = Pick<
	Context,
	| 'accountExecutor'
	| 'signerExecutor'
	| 'accountBalance'
	| 'signerBalance'
	| 'deployments'
	| 'balanceCheck'
	| 'gasFee'
>;

/**
 * Cancel a stuck operation by sending a 0-value self-transaction that reuses the
 * original nonce at a strictly higher gas price.
 */
export async function cancelOperation(
	deps: CancelDeps,
	params: {operation: OnchainOperation},
): Promise<ReplacementResult> {
	const {deployments, balanceCheck, gasFee} = deps;
	const {operation} = params;
	const $deployments = get(deployments);
	const originalTx = operation.metadata.tx;

	const guarded = selectExecutorForSender(senders(deps), originalTx.from);
	if (!guarded.ok) return guarded.result;
	const $executor = guarded.executor;

	try {
		const gasFeeValue = get(gasFee);
		const fastPrice =
			gasFeeValue.step === 'Loaded' ? gasFeeValue.fast.maxFeePerGas : 0n;
		const cancelGasPrice = deriveCancelGasPrice(
			originalTx.gasParameters as GasParameters,
			fastPrice,
		);

		const txRequest = await balanceCheck.ensureCanAfford(
			{
				transaction: {
					account: $executor.account,
					to: originalTx.from,
					value: 0n,
				},
			},
			{balance: guarded.balance, sender: $executor.address},
		);

		if (originalTx.chainId && originalTx.chainId !== $deployments.chain.id) {
			throw new Error(
				`tx to cancel is from a different chain (${originalTx.chainId}) than the current (${$deployments.chain.id})`,
			);
		}

		await $executor.client.sendTransaction({
			...txRequest,
			chain: $deployments.chain,
			nonce: originalTx.nonce,
			maxFeePerGas: cancelGasPrice,
			maxPriorityFeePerGas: cancelGasPrice,
			metadata: {
				type: 'unknown',
				name: 'Cancel Transaction',
				data: [],
			},
		});

		return {status: 'submitted'};
	} catch (err) {
		const message = toReplacementErrorMessage(
			err,
			'Failed to cancel transaction',
		);
		if (message === null) return {status: 'cancelled'};
		return {status: 'error', message};
	}
}

/**
 * Remove an operation from the local account data.
 */
export function dismissOperation(
	deps: Pick<Context, 'accountData'>,
	operationKey: string,
): void {
	const currentAccountData = deps.accountData.get();
	currentAccountData?.removeItem('operations', operationKey, {
		ignoreMissing: true,
	});
}
