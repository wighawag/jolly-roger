import type {Clock} from '$lib/context/types';
import type {AccountStore, TypedDeployments} from '$lib/core/connection/types';
import {serializer} from '$lib/core/utils/data/serializer';
import type {
	TransactionIntent,
	TransactionIntentEvent,
} from '@etherkit/tx-observer';
import type {
	KnownTrackedTransaction,
	PopulatedMetadata,
	TrackedTransaction,
} from '@etherkit/viem-tx-tracker';
import {
	createLocalStorageAdapter,
	createMultiAccountStore,
	createSyncableStore,
	defineSchema,
	map,
} from 'synqable';
import {PUBLIC_OPERATION_RETENTION_DAYS} from '$env/static/public';

/**
 * Local operations belong to a specific deployment, so the storage key is
 * scoped to the chain + genesis hash + one contract's address. Which contract
 * is app-specific, so the address is passed in rather than hardcoded here
 * (see context/config.ts: operationScopeAddress). The contract should be one
 * whose address is stable for the deployment's lifetime (e.g. the main proxy,
 * not its implementation, which changes on every upgrade).
 */

/** Default number of days to retain completed operations before deletion */
const DEFAULT_OPERATION_RETENTION_DAYS = 7;

/**
 * Parse the retention days from env variable with fallback to default.
 * Returns the retention period in milliseconds.
 */
function getOperationRetentionMs(): number {
	const days = PUBLIC_OPERATION_RETENTION_DAYS
		? parseInt(PUBLIC_OPERATION_RETENTION_DAYS, 10)
		: DEFAULT_OPERATION_RETENTION_DAYS;
	// Fallback to default if parsing fails or value is invalid
	const validDays =
		isNaN(days) || days <= 0 ? DEFAULT_OPERATION_RETENTION_DAYS : days;
	return validDays * 24 * 60 * 60 * 1000;
}

export type TransactionMetadata = PopulatedMetadata;

/**
 * Extended metadata type that includes an optional operationId.
 * When operationId is set, the transaction is added to an existing operation
 * rather than creating a new one (used for resubmit functionality).
 */
export type ExtendedTransactionMetadata = TransactionMetadata & {
	operationId?: string;
};

export type OnchainOperationMetadata = TransactionMetadata & {
	tx: Omit<TrackedTransaction<PopulatedMetadata>, 'metadata'>;
};

export type OnchainOperation = {
	metadata: OnchainOperationMetadata;
	transactionIntent: TransactionIntent;
};

const schema = defineSchema({
	operations: map<OnchainOperation>(),
});

export type Schema = typeof schema;

export function createAccountData(params: {
	accountStore: AccountStore;
	deployments: TypedDeployments;
	clock: Clock;
	/** Address of the contract that scopes local operation data. */
	scopeAddress: `0x${string}`;
}) {
	const {accountStore, deployments, clock, scopeAddress} = params;

	let lastId: number = 0;
	function generateId() {
		let id = clock.now();
		if (id === lastId) {
			id = lastId + 1;
		}
		lastId = id;
		return id.toString();
	}

	const store = createMultiAccountStore({
		accountStore,
		schema,
		factory: (account) =>
			createSyncableStore({
				schema,
				account,
				defaultData: () => {
					return {operations: {}};
				},
				clock: () => clock.now(),
				storage: {
					adapterFactory: (_privateKey) =>
						createLocalStorageAdapter(serializer),
					key: `__private__${deployments.chain.id}_${deployments.chain.genesisHash}_${scopeAddress}_${account}`,
				},
			}),
	});

	function findOperationByTxHash(txHash: string) {
		const accountData = store.get()?.get();
		if (accountData && accountData.status === 'ready') {
			const operations = accountData.data.operations;
			for (const operationID of Object.keys(operations)) {
				const txIndex = operations[
					operationID
				].transactionIntent.transactions.findIndex((tx) => tx.hash === txHash);
				if (txIndex >= 0) {
					return {operationID, txIndex};
				}
			}
		} else {
			throw new Error(`accountData not ready`);
		}
	}

	function addOperationFromTrackedTransaction(
		transaction: TrackedTransaction<TransactionMetadata>,
	) {
		const accountData = store.get();
		if (accountData) {
			const id = generateId();
			accountData.addItem(
				'operations',
				id,
				{
					transactionIntent: {
						transactions: [
							{
								broadcastTimestampMs: transaction.broadcastTimestampMs,
								from: transaction.from,
								hash: transaction.hash,
								nonce: transaction.nonce,
							},
						],
					},
					metadata: {...transaction.metadata, tx: transaction},
				},
				{deleteAt: clock.now() + getOperationRetentionMs()},
			);
		} else {
			throw new Error(`accountData not ready`);
		}
	}

	function updateOperationFromFetchedTransaction(
		transaction: KnownTrackedTransaction<TransactionMetadata>,
	) {
		const accountData = store.get();
		if (accountData) {
			const txFound = findOperationByTxHash(transaction.hash);
			if (!txFound) {
				console.error(`no operations found with tx: ${transaction.hash}`);
				return;
			}

			accountData.patchItem('operations', txFound.operationID, (operation) => ({
				...operation,
				transactionIntent: {
					...operation.transactionIntent,
					transactions: operation.transactionIntent.transactions.map((tx, i) =>
						i === txFound.txIndex ? {...tx, nonce: transaction.nonce} : tx,
					),
				},
				metadata: {
					...operation.metadata,
					tx: transaction, // we update the tx for latest parameters
				},
			}));
		} else {
			throw new Error(`accountData not ready`);
		}
	}

	function updateOperationFromTransactionStateUpdated(
		event: TransactionIntentEvent,
	) {
		const operationID = event.id;
		const accountData = store.get();
		if (accountData) {
			// tx-observer is built in a way that we can be sure that the tx belong to the current account
			if (event.intent.state?.status == 'Success' && event.intent.state.final) {
				// on Success we delete when inclusion is final
				accountData.removeItem('operations', operationID);
			} else {
				// Use patchItem to merge transactions instead of overwriting.
				// This ensures we don't lose transactions added locally that the observer
				// might not know about yet (e.g., in multi-tab scenarios or race conditions)
				accountData.patchItem('operations', operationID, (operation) => {
					const observerTxHashes = new Set(
						event.intent.transactions.map((tx) => tx.hash),
					);

					// Start with observer's transactions (they have the latest state info)
					const mergedTransactions = [...event.intent.transactions];

					// Add any local transactions that the observer doesn't know about yet
					for (const localTx of operation.transactionIntent.transactions) {
						if (!observerTxHashes.has(localTx.hash)) {
							mergedTransactions.push(localTx);
						}
					}

					return {
						...operation,
						transactionIntent: {
							...event.intent,
							transactions: mergedTransactions,
						},
					};
				});
			}
		}
	}

	/**
	 * Add a new transaction to an existing operation (used for resubmit).
	 * This adds the transaction to the operation's transactionIntent.transactions array.
	 */
	function addTransactionToOperation(
		operationId: string,
		transaction: TrackedTransaction<TransactionMetadata>,
	) {
		const accountData = store.get();
		if (accountData) {
			const currentData = accountData.get();
			if (currentData?.status !== 'ready') {
				throw new Error(`accountData not ready`);
			}

			// Check if operation exists
			const operation = currentData.data.operations[operationId];
			if (!operation) {
				console.error(`Operation not found: ${operationId}`);
				return;
			}

			accountData.patchItem('operations', operationId, (op) => {
				return {
					...op,
					transactionIntent: {
						...op.transactionIntent,
						// // Reset state since we're adding a new attempt ?
						// state: undefined,
						transactions: [
							...op.transactionIntent.transactions,
							{
								broadcastTimestampMs: transaction.broadcastTimestampMs,
								from: transaction.from,
								hash: transaction.hash,
								nonce: transaction.nonce,
							},
						],
					},
				};
			});
		} else {
			throw new Error(`accountData not ready`);
		}
	}

	/**
	 * Whether this account's data has been restored and can be read.
	 *
	 * Storage is asynchronous and per-account, so "the item is not there" and
	 * "we do not know yet" are different answers, and a caller that cannot tell
	 * them apart will report a missing thing that is merely late. Exposed here so
	 * callers ask the store rather than walking `get()?.get()?.status` into its
	 * internals.
	 */
	function isReady(): boolean {
		return store.get()?.get()?.status === 'ready';
	}

	return {
		...store,
		isReady,
		addOperationFromTrackedTransaction,
		addTransactionToOperation,
		updateOperationFromFetchedTransaction,
		updateOperationFromTransactionStateUpdated,
	};
}

export type MultiAccountDataStore = ReturnType<typeof createAccountData>;
