import {get} from 'svelte/store';
import type {GasPrice} from '$lib/core/connection/gasFee';
import type {
	ExtendedTransactionMetadata,
	OnchainOperation,
} from '$lib/account/AccountData';
import {
	InsufficientFundsError,
	isStoppedWaitingError,
} from '$lib/core/transaction';
import type {Context} from '$lib/context/types';
import type {ExecutorState} from '$lib/core/connection/executor';
import {
	selectSender,
	walletOf,
	type Sender,
} from '$lib/core/connection/senders';
import type {TxSource} from '$lib/core/connection/tx-source';
import {isUserRejectionError} from '$lib/core/transaction/user-rejection';
import {
	connectionRefusal,
	isUserDecision,
	refusalExplanation,
} from '$lib/core/connection/refusal';
import {shortAddress} from '$lib/core/utils/ethereum/address';

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
 * error is one the user already knows about and no message should be shown.
 */
export function toReplacementErrorMessage(
	err: unknown,
	fallback: string,
): string | null {
	if (err instanceof InsufficientFundsError) {
		// User dismissed the funds modal - silently cancel.
		return null;
	}
	if (isStoppedWaitingError(err)) {
		// The user stopped waiting for a wallet that had not answered. The
		// replacement may still be sent, so calling it a failure would be wrong,
		// and the in-flight ledger is what reports on it. See StoppedWaitingError.
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
	 * No route here can produce this signature. Replacements reuse the original
	 * nonce, and nonces are per-account, so sending from another account would
	 * not replace anything.
	 */
	| {status: 'wrong-account'; expected: `0x${string}`}
	| {status: 'error'; message: string};

/** User-facing explanation for the `wrong-account` replacement result. */
export function wrongAccountMessage(expected: `0x${string}`): string {
	return (
		'This transaction was sent from a different account ' +
		`(${shortAddress(expected)}). ` +
		'Reconnect with that account to replace or cancel it.'
	);
}

/**
 * The route that sent the original must be the one that replaces it, at the same
 * address: replacements reuse the nonce and nonces are per-account.
 *
 * ENSURES FIRST, ASKS AFTER. The route is selected from the recorded source and
 * then told to make itself able to sign, which is a no-op when it already can
 * and raises the connection flow when it cannot. That is the same shape as every
 * other send here (`setGreeting`, `contractCall` both open with
 * `ensureConnected`), and it is why there is no "disconnected" state for the UI
 * to render: a route that is merely asleep is not a different answer, it is the
 * same answer with a wallet prompt in front of it.
 *
 * The executor, not the connection, is the authority on whether that worked. A
 * wallet can come back holding a different account than the one asked for, and
 * that cannot sign the replacement however willingly it connected.
 */
async function requireSenderFor(
	senders: Context['senders'],
	originalTx: {from: `0x${string}`; source?: TxSource},
): Promise<
	| {
			ok: true;
			executor: Extract<ExecutorState, {status: 'ready'}>;
			balance: Sender['balance'];
	  }
	| {ok: false; result: ReplacementResult}
> {
	const selection = selectSender(senders, originalTx);
	if (selection.status === 'unavailable') {
		return {
			ok: false,
			result: {status: 'wrong-account', expected: selection.address},
		};
	}

	const sender = selection.sender;
	try {
		await sender.ensureCanSign?.({
			address: originalTx.from,
			wallet: walletOf(originalTx.source),
		});
	} catch (err) {
		// Refusing or dismissing the wallet prompt is a cancellation, not a
		// failure. NARROWED TO THE CANCELLED KIND, unlike `setGreeting` and
		// `contractCall`, which treat ANY refusal that way: they can, because they
		// leave the reason resting on the connection where `ConnectionFlow` renders
		// it. This runs inside a modal stack on top of that, and `cancelled` shows
		// the user nothing, so a declined permission or a blocked origin would
		// leave a dialog sitting there having visibly done nothing.
		const refusal = connectionRefusal(err);
		if (isUserRejectionError(err) || (refusal && isUserDecision(refusal))) {
			return {ok: false, result: {status: 'cancelled'}};
		}
		if (refusal) {
			return {
				ok: false,
				result: {status: 'error', message: refusalExplanation(refusal)},
			};
		}
		return {
			ok: false,
			result: {
				status: 'error',
				message:
					toReplacementErrorMessage(
						err,
						'Could not reach the account that sent this transaction.',
					) ?? 'Could not reach the account that sent this transaction.',
			},
		};
	}

	// TWO OUTCOMES, NOT ONE, and they must not be merged. "Nothing here can send
	// at all" and "what can send is not the account that sent this" look the same
	// from the code and read completely differently to the user: telling someone
	// their own address belongs to a different account, and asking them to
	// reconnect to the account they are already on, is worse than saying nothing.
	// Only the second is actionable, and only it gets the wrong-account wording.
	//
	// KEPT DELIBERATELY THOUGH IT SHOULD NO LONGER FIRE. Since
	// @etherplay/connect 0.12.0 a resolved `ensureCanSign` means the address was
	// reached, so the second branch is an assertion rather than a routine
	// outcome. It stays because the failure it guards is silent and expensive: a
	// replacement sent from the wrong account is not a replacement, it is a NEW
	// transaction at that account's next nonce, spending real gas and leaving the
	// stuck one exactly where it was.
	const executor = get(sender.executor);
	if (executor.status !== 'ready') {
		return {
			ok: false,
			result: {
				status: 'error',
				message:
					'No account is ready to send transactions. Reconnect your wallet and try again.',
			},
		};
	}
	if (executor.address.toLowerCase() !== originalTx.from.toLowerCase()) {
		return {
			ok: false,
			result: {status: 'wrong-account', expected: originalTx.from},
		};
	}
	return {ok: true, executor, balance: sender.balance};
}

type ResubmitDeps = Pick<Context, 'senders' | 'deployments' | 'balanceCheck'>;

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
	const {senders, deployments, balanceCheck} = deps;
	const {operation, operationKey, gasPrice} = params;
	const $deployments = get(deployments);
	const originalTx = operation.metadata.tx;

	const guarded = await requireSenderFor(senders, originalTx);
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
			// Measured against the account that is actually replacing the transaction,
			// and against the balance that travels with it: requireSenderFor has just
			// established that this is the route that sent the original.
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
	'senders' | 'deployments' | 'balanceCheck' | 'gasFee'
>;

/**
 * Cancel a stuck operation by sending a 0-value self-transaction that reuses the
 * original nonce at a strictly higher gas price.
 */
export async function cancelOperation(
	deps: CancelDeps,
	params: {operation: OnchainOperation},
): Promise<ReplacementResult> {
	const {senders, deployments, balanceCheck, gasFee} = deps;
	const {operation} = params;
	const $deployments = get(deployments);
	const originalTx = operation.metadata.tx;

	const guarded = await requireSenderFor(senders, originalTx);
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
