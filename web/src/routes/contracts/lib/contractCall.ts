import type {AbiFunction, PublicClient} from 'viem';
import type {
	AnyConnectionStore,
	UnderlyingEthereumProvider,
} from '@etherplay/connect';
import {get} from 'svelte/store';
import type {BalanceCheckStore} from '$lib/core/transaction/balance-check-store';
import type {ExecutorStore} from '$lib/core/connection/executor';
import type {BalanceStore} from '$lib/core/connection/balance';
import {
	InsufficientFundsError,
	isStoppedWaitingError,
} from '$lib/core/transaction';
import {isUserRejectionError} from '$lib/core/transaction/user-rejection';
import {connectionRefusal, isUserDecision} from '$lib/core/connection/refusal';
import {convertInputValues} from './utils';

/**
 * Read a view/pure function on an arbitrary contract.
 *
 * Converts the raw UI input map to typed args and performs the `readContract`
 * call. Throws on failure (the caller renders the message).
 */
export async function readContractValue(params: {
	publicClient: PublicClient;
	abiItem: AbiFunction;
	contractAddress: string;
	inputValues: Record<string, string>;
}): Promise<unknown> {
	const {publicClient, abiItem, contractAddress, inputValues} = params;

	if (!publicClient) {
		throw new Error('Public client not available');
	}

	const args = convertInputValues(abiItem.inputs, inputValues);

	return publicClient.readContract({
		address: contractAddress as `0x${string}`,
		abi: [abiItem],
		functionName: abiItem.name,
		// Dynamic args from user input - type cannot be inferred at compile time
		args: args as any,
	});
}

export type ExecuteContractWriteResult =
	| {status: 'submitted'; transactionHash: `0x${string}`}
	| {status: 'cancelled'}
	| {status: 'cannot-send'};

/**
 * Execute a state-changing function on an arbitrary contract.
 *
 * Owns the connect + balance-check + write flow. Returns `cancelled` when the
 * user dismisses the insufficient-funds modal, `cannot-send` when the connected
 * account cannot send under the configured execution mode; throws on any other
 * failure.
 */
export async function executeContractWrite(params: {
	connection: AnyConnectionStore<UnderlyingEthereumProvider>;
	/**
	 * Which account to send from. The contracts page is a developer tool for
	 * calling arbitrary functions, so the caller names the executor rather than
	 * this guessing one, and passes the balance that executor spends.
	 */
	executor: ExecutorStore;
	balance: BalanceStore;
	balanceCheck: BalanceCheckStore;
	abiItem: AbiFunction;
	contractAddress: string;
	inputValues: Record<string, string>;
}): Promise<ExecuteContractWriteResult> {
	const {
		connection,
		executor,
		balance,
		balanceCheck,
		abiItem,
		contractAddress,
		inputValues,
	} = params;

	const args = convertInputValues(abiItem.inputs, inputValues);

	try {
		await connection.ensureConnected();
	} catch (e) {
		// Rejecting or dismissing the wallet prompt is a cancellation, not an
		// error worth surfacing (setGreeting treats it the same way). Before
		// @etherplay/connect 0.1.0 this call never settled at all, so there was
		// nothing to catch and the flow just hung here.
		if (isUserRejectionError(e)) return {status: 'cancelled'};
		// Nor is any other way the connection came back empty. Since
		// @etherplay/connect 0.6.0 that includes the wallet host's own refusals,
		// each of which rests on the connection with its own reason and is rendered
		// there by ConnectionFlow. Rethrowing put the raw text ("Connection
		// cancelled") in this page's red alert as though the contract had refused
		// the call.
		// ONLY A DECISION IS SILENT. This used to swallow every refusal, which was
		// right when the alternative was a raw "Connection cancelled" in a red
		// alert. Since @etherplay/connect 0.13.0 a failure says WHY, and two of
		// the reasons (`unreachable`, `superseded`) are answers the library went
		// to some trouble to produce instead of hanging: reporting them as a
		// cancellation turns that work back into silence.
		const refusal = connectionRefusal(e);
		if (refusal && isUserDecision(refusal)) return {status: 'cancelled'};
		throw e;
	}

	const $executor = get(executor);
	if ($executor.status === 'cannot-send') return {status: 'cannot-send'};
	if ($executor.status !== 'ready') return {status: 'cancelled'};

	try {
		const contractRequest = await balanceCheck.ensureCanAfford(
			{
				contract: {
					address: contractAddress as `0x${string}`,
					abi: [abiItem],
					functionName: abiItem.name,
					args: args as any,
					account: $executor.account,
				},
			},
			{balance, sender: $executor.address},
		);

		const hash = await $executor.client.writeContract(contractRequest);
		return {status: 'submitted', transactionHash: hash};
	} catch (e) {
		if (e instanceof InsufficientFundsError) {
			// User dismissed the funds modal - silently cancel.
			return {status: 'cancelled'};
		}
		// The user stopped waiting for a wallet that had not answered. The request
		// is still with it and may still be sent, so this is not a failure to
		// report: it just releases this call. See StoppedWaitingError.
		if (isStoppedWaitingError(e)) return {status: 'cancelled'};
		throw e;
	}
}
