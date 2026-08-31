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

/**
 * Everything in an operations key EXCEPT which account's list it is.
 *
 * Where one account's operations are stored, minus the account. Written ONCE
 * and shared by both users (the live store's key, and the scan in
 * {@link readAllStoredOperations}), because two copies of a storage key formula
 * is two chances to read from a slightly different place than you wrote to.
 *
 * Being able to name the scope WITHOUT naming an account is what lets the scan
 * find every list this browser holds without knowing whose they are. That in
 * turn is why nothing here has to guess at address CASING any more: the account
 * is read out of the key rather than built into it, so there is no spelling to
 * get wrong. The scope's own casing cannot drift, since the writer and the
 * reader are handed the same `operationScopeAddress(deployments)` value.
 */
function operationsStorageKeyPrefix(params: {
	chainId: number;
	genesisHash: string;
	scopeAddress: `0x${string}`;
}): string {
	const {chainId, genesisHash, scopeAddress} = params;
	return `__private__${chainId}_${genesisHash}_${scopeAddress}_`;
}

function operationsStorageKey(params: {
	chainId: number;
	genesisHash: string;
	scopeAddress: `0x${string}`;
	account: string;
}): string {
	const {account, ...scope} = params;
	return `${operationsStorageKeyPrefix(scope)}${account}`;
}

/**
 * Parse one stored operations envelope. `undefined` means NOT KNOWN.
 *
 * THE SHAPE IS SYNQABLE'S, AND IT IS NOT A PUBLIC CONTRACT. `{$version, data:
 * {operations}}` is what `createSyncableStore` writes today, read back here
 * without going through it. If that ever changes this must degrade to "I do not
 * know" and never to "there are none", because the second is the app inventing
 * evidence that it never saw a transaction, which is the failure this whole
 * feature exists to prevent. Hence the explicit check below rather than a
 * `?? {}`. `test/lib/account/stored-operations.svelte.test.ts` writes through
 * the real store and reads back through here, so drift fails loudly, not
 * quietly.
 */
function parseStoredOperations(
	raw: string | null,
): Record<string, OnchainOperation> | undefined {
	if (!raw) return undefined;
	try {
		const stored = serializer.deserialize(raw) as
			{data?: {operations?: Record<string, OnchainOperation>}} | undefined;
		const operations = stored?.data?.operations;
		if (!operations || typeof operations !== 'object') return undefined;
		return operations;
	} catch {
		return undefined;
	}
}

/**
 * Every stored operations list on this chain and deployment, whoever's it is.
 *
 * WHY WHOSE LIST IT IS DOES NOT MATTER. The one question this serves is "has
 * this app already recorded a transaction from sender S at nonce N", and that
 * pair names ONE transaction slot on a chain: a nonce belongs to the account
 * that signs, not to the player whose list happens to hold the record. So the
 * scope an operation was filed under carries no information for this question,
 * and searching every scope is the accurate way to ask it rather than a
 * scattergun.
 *
 * Reading one scope was accurate only while the sender and the list-owner were
 * the same address, which stopped being true when a second sender arrived. A
 * signer's transactions are filed under the PLAYER, and so are a payer's, so
 * looking them up under their own address found an empty scope that is never
 * written and reported NOT KNOWN for a transaction sitting in the user's list.
 *
 * `complete` is false when anything could not be read (no storage at all, or an
 * envelope that would not parse). A caller may trust a HIT either way, since
 * finding the transaction is definite; only a MISS needs completeness, because
 * the thing we failed to read is exactly where the answer might have been.
 */
export function readAllStoredOperations(params: {
	deployments: TypedDeployments;
	scopeAddress: `0x${string}`;
}): {
	operations: Record<string, OnchainOperation>[];
	complete: boolean;
} {
	const {deployments, scopeAddress} = params;
	if (typeof localStorage === 'undefined') {
		return {operations: [], complete: false};
	}

	const prefix = operationsStorageKeyPrefix({
		chainId: deployments.chain.id,
		genesisHash: deployments.chain.genesisHash,
		scopeAddress,
	});

	const operations: Record<string, OnchainOperation>[] = [];
	let complete = true;
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(prefix)) continue;
			const parsed = parseStoredOperations(localStorage.getItem(key));
			// An envelope under our own prefix that we cannot read is the one case
			// that must not be silently skipped: it may be the list holding the
			// transaction being asked about.
			if (parsed === undefined) complete = false;
			else operations.push(parsed);
		}
	} catch {
		// Enumeration itself failed (a storage that throws on access). Whatever was
		// gathered still counts, but a miss can no longer be trusted.
		complete = false;
	}

	return {operations, complete};
}

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
					key: operationsStorageKey({
						chainId: deployments.chain.id,
						genesisHash: deployments.chain.genesisHash,
						scopeAddress,
						account,
					}),
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
