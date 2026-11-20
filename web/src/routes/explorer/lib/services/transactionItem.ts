import type {PublicClient, Transaction, TransactionReceipt} from 'viem';
import {
	decodeTransaction,
	type DecodedTransactionData,
} from './transactionDecoder';
import type {DecodingContracts} from '../utils';

export interface TransactionItemData {
	decodedData: DecodedTransactionData;
	receipt: TransactionReceipt | null;
}

/**
 * Load the per-item data for a transaction row: fetch its receipt (tolerating a
 * still-pending tx) and decode it. Keeps the async orchestration out of the
 * TransactionItem component.
 */
export async function loadTransactionItemData(
	tx: Transaction,
	publicClient: PublicClient,
	contracts: DecodingContracts,
): Promise<TransactionItemData> {
	let receipt: TransactionReceipt | null = null;
	try {
		receipt = await publicClient.getTransactionReceipt({hash: tx.hash});
	} catch {
		// Transaction might still be pending; decode without a receipt.
	}

	const decodedData = await decodeTransaction(
		tx,
		receipt,
		publicClient,
		contracts,
	);
	return {decodedData, receipt};
}
