import {writable} from 'svelte/store';
import type {Block, PublicClient, Transaction, TransactionReceipt} from 'viem';
import {
	decodeTransaction,
	type DecodedTransactionData,
} from '../services/transactionDecoder';
import {decodeLogs, type DecodedEvent} from '../utils';
import {deployments} from '$lib/deployments-store';

export interface TransactionDetailsState {
	tx: Transaction | null;
	receipt: TransactionReceipt | null;
	block: Block | null;
	decodedTxData: DecodedTransactionData;
	decodedEvents: DecodedEvent[];
	loading: boolean;
	error: string | null;
}

const initialState: TransactionDetailsState = {
	tx: null,
	receipt: null,
	block: null,
	decodedTxData: {isDecoded: false, status: 'pending'},
	decodedEvents: [],
	loading: false,
	error: null,
};

/**
 * Store owning the full detail load for one transaction: tx, receipt, block,
 * decoded call data and decoded events. Mirrors the other explorer stores so
 * TransactionView only subscribes and renders.
 */
export function createTransactionDetailsStore(params: {
	publicClient: PublicClient;
}) {
	const {publicClient} = params;
	const {subscribe, set, update} =
		writable<TransactionDetailsState>(initialState);

	async function fetch(txHash: `0x${string}` | null): Promise<void> {
		if (!txHash) {
			set({...initialState});
			return;
		}
		if (!publicClient) {
			set({...initialState, error: 'Public client not available'});
			return;
		}

		update((state) => ({...state, loading: true, error: null}));

		try {
			const tx = await publicClient.getTransaction({hash: txHash});
			const receipt = await publicClient.getTransactionReceipt({hash: txHash});

			let block: Block | null = null;
			if (receipt) {
				block = await publicClient.getBlock({blockNumber: receipt.blockNumber});
			}

			// Read at call time, so a changed deployments store is followed.
			const contracts = deployments.get().contracts;
			const decodedTxData = await decodeTransaction(
				tx,
				receipt,
				publicClient,
				contracts,
			);
			const decodedEvents =
				receipt && receipt.logs.length > 0
					? decodeLogs(receipt.logs, contracts)
					: [];

			set({
				tx,
				receipt,
				block,
				decodedTxData,
				decodedEvents,
				loading: false,
				error: null,
			});
		} catch (e: unknown) {
			const error = e as Error;
			console.error('Error fetching transaction:', e);
			update((state) => ({
				...state,
				error: error.message || 'Failed to fetch transaction',
				loading: false,
			}));
		}
	}

	return {subscribe, fetch};
}

const storeInstances = new WeakMap<
	PublicClient,
	ReturnType<typeof createTransactionDetailsStore>
>();

export function getTransactionDetailsStore(params: {
	publicClient: PublicClient;
}) {
	let store = storeInstances.get(params.publicClient);
	if (!store) {
		store = createTransactionDetailsStore(params);
		storeInstances.set(params.publicClient, store);
	}
	return store;
}
