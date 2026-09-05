import {get} from 'svelte/store';
import type {GasPrice} from '$lib/core/connection/gasFee';
import type {
	OnchainOperation,
	TransactionMetadata,
} from '$lib/account/AccountData';
import type {IntendedGasParameters} from '@etherkit/viem-tx-tracker';
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

/** The larger of the two, treating "not stated" as no constraint. */
function higher(
	a: bigint | undefined,
	b: bigint | undefined,
): bigint | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return a > b ? a : b;
}

/**
 * The floor a replacement has to clear: the HIGHEST fee any attempt of this
 * operation already paid.
 *
 * THE MAXIMUM, NOT THE LAST ONE. A replacement only replaces if it outbids
 * every transaction already sitting at that nonce, so the constraint is the
 * largest of them. "The last" would also be right most of the time, and only
 * most: nothing in the type guarantees the array is in dispatch order, and a
 * floor derived from a lower attempt is silently accepted by the UI and then
 * rejected by the node as an underpriced replacement. Max does not care about
 * the order.
 *
 * `undefined` means no attempt stated a fee, so there is nothing to clear.
 */
export function deriveMinGasPrice(
	operation: OnchainOperation | null,
): GasPrice | undefined {
	if (!operation) return undefined;

	let maxFeePerGas: bigint | undefined;
	let maxPriorityFeePerGas: bigint | undefined;

	for (const attempt of operation.attempts ?? []) {
		const gasParams = attempt.gasParameters;
		// A legacy attempt states one price that serves as both.
		maxFeePerGas = higher(
			maxFeePerGas,
			gasParams?.maxFeePerGas ?? gasParams?.gasPrice,
		);
		maxPriorityFeePerGas = higher(
			maxPriorityFeePerGas,
			gasParams?.maxPriorityFeePerGas ?? gasParams?.gasPrice,
		);
	}

	if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) {
		return undefined;
	}
	return {maxFeePerGas, maxPriorityFeePerGas};
}

/**
 * THE SLOT A REPLACEMENT IS FOR: the nonce of the most recently broadcast
 * attempt.
 *
 * Every attempt of an operation shares a nonce today, because the only thing
 * that appends one is a resubmit and a resubmit reuses it. So this is the same
 * answer as "the first attempt" for every record this build can write, and it
 * is chosen anyway because the SHAPE deliberately permits attempts at different
 * nonces (a dropped transaction re-sent at a fresh one is still the same
 * intent). Should that ever happen, the slot worth replacing is the one the
 * latest dispatch occupies; the earliest is by then a nonce nothing is waiting
 * on.
 *
 * By TIMESTAMP rather than by array position, for the same reason
 * `deriveMinGasPrice` takes a maximum: nothing in the type guarantees the array
 * is in dispatch order.
 */
function replacementNonce(operation: OnchainOperation): number | undefined {
	let latest: {nonce: number; broadcastTimestampMs: number} | undefined;
	for (const attempt of operation.attempts ?? []) {
		if (
			!latest ||
			(attempt.broadcastTimestampMs ?? 0) > (latest.broadcastTimestampMs ?? 0)
		) {
			latest = attempt;
		}
	}
	return latest?.nonce;
}

/**
 * The gas price to use when cancelling: the higher of the original fee + 1 wei
 * and the current network "fast" fee, so the cancel strictly replaces the
 * pending tx.
 */
export function deriveCancelGasPrice(
	originalGasParameters: IntendedGasParameters | undefined,
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

/**
 * An operation with no recorded broadcast: there is no nonce to reuse, so there
 * is nothing to replace. Its own constant so the resubmit and the cancel cannot
 * word the same dead end two different ways.
 */
const NO_ATTEMPT_TO_REPLACE: ReplacementResult = {
	status: 'error',
	message:
		'This operation has no recorded transaction, so there is nothing to replace.',
};

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
	const call = operation.call;
	const nonce = replacementNonce(operation);
	// NO SLOT, NO REPLACEMENT. Sending without a nonce is not a replacement at
	// all: the wallet picks the next free one and the result is a SECOND
	// transaction, spending real gas while the stuck one stays exactly where it
	// was. Refusing is the honest answer, and this is reachable, if only through
	// a record whose attempts list is empty.
	if (nonce === undefined) return NO_ATTEMPT_TO_REPLACE;

	const guarded = await requireSenderFor(senders, call);
	if (!guarded.ok) return guarded.result;
	const $executor = guarded.executor;

	try {
		const txRequest = await balanceCheck.ensureCanAfford(
			{
				transaction: {
					account: $executor.account,
					to: call.to as `0x${string}`,
					data: call.data,
					value: call.value,
				},
			},
			// Measured against the account that is actually replacing the transaction,
			// and against the balance that travels with it: requireSenderFor has just
			// established that this is the route that sent the original.
			{balance: guarded.balance, sender: $executor.address},
		);

		// METADATA SAYS WHAT THE TRANSACTION MEANS, AND NOTHING ELSE. The link to
		// the operation being replaced is not part of that, so it does not travel
		// here (it used to, as `operationId`, and was then persisted into every
		// resubmitted record).
		const resubmitMetadata: TransactionMetadata = {
			type: 'unknown',
			name: 'Resubmit Transaction',
			data: [],
		};

		if (call.chainId && call.chainId !== $deployments.chain.id) {
			throw new Error(
				`tx to resubmit is from a different chain (${call.chainId}) than the current (${$deployments.chain.id})`,
			);
		}

		await $executor.client.sendTransaction({
			...txRequest,
			chain: $deployments.chain,
			nonce,
			maxFeePerGas: gasPrice.maxFeePerGas,
			maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
			metadata: resubmitMetadata,
			// WHICH OPERATION THIS SEND IS REPLACING, travelling beside the
			// metadata rather than inside it. The tracker carries it verbatim onto
			// `transaction:broadcasted`, where `connectors.ts` reads it and
			// attaches this attempt to that operation.
			//
			// EPHEMERAL, AND NOT STORED. Nothing writes it into the record: it says
			// which request this send answers, not anything about the transaction.
			// The operation key is used as the value because it IS the routing
			// target and is already known here; see the note in the commit message
			// on why this does not go through a generated token and a map.
			//
			// ONLY THE RESUBMIT SENDS ONE. A cancel reuses the same nonce but must
			// create its own operation: attaching it would make the stuck operation
			// report the cancel's Success, and account data deletes an operation
			// that reports final success, so the transaction the user was
			// cancelling would announce that it succeeded and disappear.
			correlation: operationKey,
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
	const call = operation.call;
	const nonce = replacementNonce(operation);
	// Same reasoning as the resubmit: a cancel without the original nonce is a
	// 0-value self-send that cancels nothing.
	if (nonce === undefined) return NO_ATTEMPT_TO_REPLACE;

	const guarded = await requireSenderFor(senders, call);
	if (!guarded.ok) return guarded.result;
	const $executor = guarded.executor;

	try {
		const gasFeeValue = get(gasFee);
		const fastPrice =
			gasFeeValue.step === 'Loaded' ? gasFeeValue.fast.maxFeePerGas : 0n;
		// Against the HIGHEST fee any attempt paid, for the same reason the
		// resubmit floor is: the cancel has to outbid every transaction already
		// sitting at this nonce, not merely the one that happens to be listed last.
		const floor = deriveMinGasPrice(operation);
		const cancelGasPrice = deriveCancelGasPrice(
			floor && {maxFeePerGas: floor.maxFeePerGas},
			fastPrice,
		);

		const txRequest = await balanceCheck.ensureCanAfford(
			{
				transaction: {
					account: $executor.account,
					to: call.from,
					value: 0n,
				},
			},
			{balance: guarded.balance, sender: $executor.address},
		);

		if (call.chainId && call.chainId !== $deployments.chain.id) {
			throw new Error(
				`tx to cancel is from a different chain (${call.chainId}) than the current (${$deployments.chain.id})`,
			);
		}

		// NO `correlation` HERE, DELIBERATELY, which is what makes the broadcast
		// handler file this as its OWN operation. See the note in
		// `resubmitOperation`: attaching a cancel to the operation it cancels would
		// make that operation report the cancel's Success, and account data deletes
		// an operation that reports final success, so the transaction the user was
		// getting rid of would announce that it succeeded and disappear.
		await $executor.client.sendTransaction({
			...txRequest,
			chain: $deployments.chain,
			nonce,
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
