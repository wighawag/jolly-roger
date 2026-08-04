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
import {keccak256, toHex} from 'viem';

/**
 * A short, stable fingerprint of the current deployment.
 *
 * Local account data is scoped to the deployment it belongs to, so a redeploy
 * does not leave the app reading operations that point at contracts which no
 * longer exist.
 *
 * Every deployed address participates, rather than one contract named here.
 * Naming one made this template file app-specific: every project built on the
 * template had to edit it, and then re-resolve that edit on every merge from
 * upstream.
 */
function deploymentFingerprint(deployments: TypedDeployments): string {
	const contracts = deployments.contracts as Record<string, {address: string}>;
	const addresses = Object.keys(contracts)
		.sort()
		.map((contractName) => contracts[contractName].address)
		.join(',');
	return keccak256(toHex(addresses)).slice(2, 18);
}

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
}) {
	const {accountStore, deployments, clock} = params;

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
					key: `__private__${deployments.chain.id}_${deployments.chain.genesisHash}_${deploymentFingerprint(deployments)}_${account}`,
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

	return {
		...store,
		addOperationFromTrackedTransaction,
		addTransactionToOperation,
		updateOperationFromFetchedTransaction,
		updateOperationFromTransactionStateUpdated,
	};
}

export type MultiAccountDataStore = ReturnType<typeof createAccountData>;
