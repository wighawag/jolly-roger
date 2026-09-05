import type {Clock} from '$lib/context/types';
import type {AccountStore, TypedDeployments} from '$lib/core/connection/types';
import {serializer} from '$lib/core/utils/data/serializer';
import type {
	BroadcastedTransactionState,
	ExpectedUpdate,
	TransactionIntentEvent,
	TransactionIntentState,
} from '@etherkit/tx-observer';
import type {
	IntendedGasParameters,
	KnownTrackedTransaction,
	PopulatedMetadata,
	TrackedTransaction,
} from '@etherkit/viem-tx-tracker';
import type {TxSource} from '$lib/core/connection/tx-source';
import {
	OPERATIONS_SCHEMA_VERSION,
	upgradeStoredOperations,
} from './operations-migration';
import {
	createLocalStorageAdapter,
	createMultiAccountStore,
	createSyncableStore,
	defineSchema,
	map,
} from 'synqable';
import {PUBLIC_OPERATION_RETENTION_DAYS} from '$env/static/public';
import {getAddress} from 'viem';

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
 * WHAT WAS ASKED, once. Identical across attempts by construction: a
 * replacement re-sends the same call at a higher price, so nothing here can
 * differ between tries, and storing it per attempt would invite the two copies
 * to disagree.
 *
 * `from` and `source` are hoisted for the same reason the replacement path
 * exists: replacing reuses the nonce, nonces are per-account, so ONE route owns
 * the slot for the whole operation. If a per-attempt route ever becomes real
 * they move down into {@link OperationAttempt} and only the projection changes.
 *
 * `source` is what makes "which route signed this" survive a reload. It is
 * declared as present because everything sent from now on carries one; records
 * written before it existed do not, which is what `isKnownSource` is for.
 */
export type OperationCall = {
	from: `0x${string}`;
	to: `0x${string}` | null;
	value: bigint;
	data: `0x${string}`;
	chainId?: number;
	source: TxSource;
};

/**
 * ONE BROADCAST. Only the parts that differ between tries.
 *
 * `nonce` STAYS HERE rather than being hoisted beside `from`. Hoisting it would
 * encode "one operation is one nonce slot", which is true of replacement and
 * not of the observer's model: a dropped transaction re-sent at a fresh nonce
 * is still the same intent, and a record shaped to forbid that would have to be
 * migrated again the day detection lands.
 *
 * `gasParameters` is the TRACKER'S OWN TYPE, deliberately the all-optional
 * `IntendedGasParameters` rather than the txType-discriminated union: it is the
 * one arm every other arm is assignable to, so a stored attempt can be read for
 * a fee without a cast and without switching on `txType` at every call site
 * (see `deriveMinGasPrice`).
 *
 * `state` is OBSERVER-OWNED and matched by hash. The app never writes it.
 */
export type OperationAttempt = {
	hash: `0x${string}`;
	nonce: number;
	broadcastTimestampMs: number;
	gasParameters: IntendedGasParameters;
	txType?: string;
	state?: BroadcastedTransactionState;
};

/**
 * ONE FACT, ONE OWNER, ONE HOME.
 *
 * - `metadata` is app-owned and written once at creation: what the transaction
 *   MEANS, the tracker's metadata verbatim and nothing else. Plumbing does not
 *   travel in it, which is why there is no `operationId` here: a replacement
 *   names its operation through the tracker's `correlation`, which is carried
 *   on the event and deliberately never stored.
 * - `call` and `attempts` are app-owned: what was asked, and each time it was
 *   sent.
 * - `state` and `attempts[].state` are OBSERVER-OWNED.
 *
 * There is no stored `transactionIntent`. The observer's view of an operation
 * is a PROJECTION of the fields above (see `toTransactionIntent`), built where
 * the observer is fed. Storing it as well is what let the same transaction
 * exist twice, in two shapes, and let an observer update overwrite dispatch
 * facts the observer never had.
 */
export type OnchainOperation = {
	metadata: TransactionMetadata;
	/**
	 * What would prove this happened even if none of our transactions did it.
	 * Carried and persisted, never invented: detection is not wired up, and a
	 * field the app fabricates is worse than one it does not have.
	 */
	expectedUpdate?: ExpectedUpdate;
	call: OperationCall;
	attempts: OperationAttempt[];
	state?: TransactionIntentState;
};

const schema = defineSchema({
	operations: map<OnchainOperation>(),
});

export type Schema = typeof schema;

/**
 * Where one account's operations are stored, for this deployment.
 *
 * Extracted so it is written ONCE. It is used both to build the live store and
 * to read an account's operations WITHOUT one (see {@link readStoredOperations}),
 * and two copies of a storage key formula is two chances to read from a slightly
 * different place than you wrote to.
 */
function operationsStorageKey(params: {
	chainId: number;
	genesisHash: string;
	scopeAddress: `0x${string}`;
	account: string;
}): string {
	const {chainId, genesisHash, scopeAddress, account} = params;
	return `__private__${chainId}_${genesisHash}_${scopeAddress}_${account}`;
}

/**
 * Read an account's stored operations directly, with no connection to it.
 *
 * WHY THIS EXISTS. The live store holds ONE account at a time, the one that is
 * currently connected, which is fine for showing a user their transactions and
 * useless for the thing that has to work when nobody is connected: reconciling
 * an in-flight record left behind by a session that is over. On a reload with a
 * locked wallet there is no account, so the live store cannot answer "do we
 * already have an operation at this nonce?", and the app fell back to guessing
 * from the chain and told the user a transaction might have been sent while it
 * was sitting in their list.
 *
 * Storage does not have that limitation: the key is derived from the chain, the
 * deployment and the address, all of which a record carries. So this reads the
 * account named on the record rather than the account that happens to be
 * connected.
 *
 * `undefined` means NOT KNOWN, and is returned for every way this can fail to
 * produce a real answer: no key, unparseable contents, or a payload that is not
 * the shape expected. There is no loading state to confuse it with, since
 * localStorage is synchronous.
 *
 * THE SHAPE IS SYNQABLE'S, AND IT IS NOT A PUBLIC CONTRACT. `{$version, data:
 * {operations}}` is what `createSyncableStore` writes today, read back here
 * without going through it. If that ever changes this must degrade to "I do not
 * know" and never to "there are none", because the second is the app inventing
 * evidence that it never saw a transaction, which is the failure this whole
 * feature exists to prevent. Hence the explicit check below rather than a
 * `?? {}`. `test/lib/account/stored-operations.svelte.test.ts` writes through the
 * real store and reads back through here, so drift fails loudly, not quietly.
 *
 * IT ALSO OWES THE STORE'S MIGRATIONS. Bypassing the store means bypassing what
 * the store does on load, and a record written by an older build is not the
 * shape the callers expect. The same upgrade function runs here; see the note
 * at the return, and `operations-migration.ts` for why there is only one.
 *
 * Synqable also debounces its saves, so for an account that is NOT the connected
 * one this can lag the live store by a moment. Harmless: a missing recent
 * operation makes reconciliation fall through to the nonce comparison, which is
 * what it would have done anyway.
 */
export function readStoredOperations(params: {
	deployments: TypedDeployments;
	scopeAddress: `0x${string}`;
	account: `0x${string}`;
}): Record<string, OnchainOperation> | undefined {
	const {deployments, scopeAddress, account} = params;
	if (typeof localStorage === 'undefined') return undefined;

	// BOTH SPELLINGS, the way `nonce-cache.ts` queries both when asking a wallet
	// for a nonce. The key embeds whatever the multi-account store was handed,
	// which is normally the provider's lowercase form, while an in-flight record
	// can carry a checksummed one. Same account, two strings, and looking under
	// only one of them returns NOT KNOWN for data that is right there: the user is
	// then told a transaction "may have been sent" while it sits in their list,
	// which is the exact failure this reader exists to remove. Assuming one casing
	// would be an assumption about every wallet, forever.
	const spellings = new Set<string>([account, account.toLowerCase()]);
	try {
		// The checksummed form too, so the lookup works whichever spelling WROTE
		// the key, not merely whichever one is asking. Derived rather than assumed:
		// lowercasing the query only covers one of the two directions.
		spellings.add(getAddress(account));
	} catch {
		// Not a checksummable address; the other spellings still apply.
	}

	const keys = [...spellings].map((spelling) =>
		operationsStorageKey({
			chainId: deployments.chain.id,
			genesisHash: deployments.chain.genesisHash,
			scopeAddress,
			account: spelling,
		}),
	);

	try {
		const raw = keys.reduce<string | null>(
			(found, key) => found ?? localStorage.getItem(key),
			null,
		);
		if (!raw) return undefined;
		const stored = serializer.deserialize(raw) as
			| {$version?: number; data?: {operations?: Record<string, unknown>}}
			| undefined;
		const operations = stored?.data?.operations;
		// Deliberately not `?? {}`: an envelope we cannot read is unknown, not empty.
		if (!operations || typeof operations !== 'object') return undefined;

		// THE SECOND READ PATH, AND IT NEEDS THE SAME MIGRATION. This bypasses the
		// store entirely, so without this it would keep handing out pre-migration
		// records that the rest of the app no longer understands - and the caller
		// is reconciliation, which would then read no nonces off them and tell the
		// user a transaction may have been sent while it sits in their list.
		//
		// Version-gated, not unconditional: the migration is cheap but re-running
		// it on every scan of an already-current store is work for nothing.
		if ((stored?.$version ?? 0) < OPERATIONS_SCHEMA_VERSION) {
			return upgradeStoredOperations(stored).data.operations;
		}
		return operations as Record<string, OnchainOperation>;
	} catch {
		// Unreadable is not empty: saying "no operations" here would be inventing
		// evidence that the app never saw a transaction.
		return undefined;
	}
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
				// ONE UPGRADE FUNCTION, TWO READ PATHS. This is the store's; the
				// same function is applied in `readStoredOperations`, which parses
				// localStorage itself and never comes through here.
				schemaVersion: OPERATIONS_SCHEMA_VERSION,
				migrations: {
					[OPERATIONS_SCHEMA_VERSION]: upgradeStoredOperations,
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
				const txIndex = operations[operationID].attempts.findIndex(
					(attempt) => attempt.hash === txHash,
				);
				if (txIndex >= 0) {
					return {operationID, txIndex};
				}
			}
		} else {
			throw new Error(`accountData not ready`);
		}
	}

	/** The dispatch facts of one broadcast, as an attempt. */
	function attemptOf(
		transaction: TrackedTransaction<TransactionMetadata, TxSource>,
	): OperationAttempt {
		return {
			hash: transaction.hash,
			nonce: transaction.nonce,
			broadcastTimestampMs: transaction.broadcastTimestampMs,
			gasParameters: transaction.gasParameters,
			...(transaction.txType !== undefined ? {txType: transaction.txType} : {}),
		};
	}

	/** What was asked, from the same broadcast. */
	function callOf(
		transaction: TrackedTransaction<TransactionMetadata, TxSource>,
	): OperationCall {
		return {
			from: transaction.from,
			to: transaction.to,
			value: transaction.value,
			data: transaction.data,
			...(transaction.chainId !== undefined
				? {chainId: transaction.chainId}
				: {}),
			source: transaction.source,
		};
	}

	function addOperationFromTrackedTransaction(
		transaction: TrackedTransaction<TransactionMetadata, TxSource>,
	) {
		const accountData = store.get();
		if (accountData) {
			const id = generateId();
			accountData.addItem(
				'operations',
				id,
				{
					// The tracker's metadata VERBATIM, and nothing else beside it.
					metadata: transaction.metadata,
					call: callOf(transaction),
					attempts: [attemptOf(transaction)],
				},
				{deleteAt: clock.now() + getOperationRetentionMs()},
			);
		} else {
			throw new Error(`accountData not ready`);
		}
	}

	/**
	 * Fold in the transaction's FINAL values, once the tracker has them.
	 *
	 * "Known", not "fetched", matching `transaction:known` and the `known: true`
	 * discriminant on the payload: it names the promise (these values are final
	 * rather than intended) instead of the mechanism, which is not uniform. An
	 * ordinary send reads them back from the chain; a raw send parses them from
	 * the signed payload and fetches nothing.
	 *
	 * It is NOT a mined signal. It fires while the transaction is still in the
	 * mempool, so nothing here may treat it as inclusion; inclusion is the
	 * observer's to report, through `state`.
	 */
	function updateOperationFromKnownTransaction(
		transaction: KnownTrackedTransaction<TransactionMetadata, TxSource>,
	) {
		const accountData = store.get();
		if (accountData) {
			const txFound = findOperationByTxHash(transaction.hash);
			if (!txFound) {
				console.error(`no operations found with tx: ${transaction.hash}`);
				return;
			}

			// The chain's own values for the attempt that was fetched, and for the
			// call it made. PER FIELD, not by replacing the record: the fetched
			// transaction is one attempt, and it knows nothing about the others or
			// about the observer state already sitting on them.
			accountData.patchItem('operations', txFound.operationID, (operation) => ({
				...operation,
				call: {...operation.call, ...callOf(transaction)},
				attempts: operation.attempts.map((attempt, i) =>
					i === txFound.txIndex
						? {
								...attempt,
								...attemptOf(transaction),
								// Observer-owned, and the fetch has no opinion on it.
								state: attempt.state,
							}
						: attempt,
				),
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
			if (
				event.intent.state?.outcome === 'Success' &&
				event.intent.state.final
			) {
				// on Success we delete when inclusion is final
				accountData.removeItem('operations', operationID);
			} else {
				// THE OBSERVER OWNS STATE AND ONLY STATE.
				//
				// This used to rebuild `transactions` as the observer's array plus
				// whatever local entries it did not have, which meant a state update
				// REPLACED the stored transactions wholesale. Everything the observer
				// was never told about went with them: gas parameters, the source
				// route, the calldata. The merge existed to defend against the
				// observer holding a transaction the store did not, which cannot
				// happen: the observer is FED FROM THE STORE (see
				// `hookTxObserverToAccountData`), so its transactions are always a
				// subset of ours.
				//
				// So: the app owns `attempts`, and this patches ONLY the per-hash
				// state and the intent state. A hash we do not have is ignored rather
				// than adopted, because adopting it would be inventing an attempt.
				accountData.patchItem('operations', operationID, (operation) => {
					const stateByHash = new Map(
						event.intent.transactions.map((tx) => [tx.hash, tx.state]),
					);

					return {
						...operation,
						attempts: operation.attempts.map((attempt) =>
							stateByHash.has(attempt.hash)
								? {...attempt, state: stateByHash.get(attempt.hash)}
								: attempt,
						),
						state: event.intent.state,
					};
				});
			}
		}
	}

	/**
	 * Add a new broadcast to an existing operation (used for resubmit).
	 *
	 * Appends an ATTEMPT and touches nothing else: the call is identical by
	 * construction (a replacement re-sends the same bytes at a higher price) and
	 * the metadata still says what the operation means. The observer state is
	 * left alone; the observer recomputes it from the new attempt list.
	 *
	 * RETURNS WHETHER IT ATTACHED, rather than swallowing a miss. The named
	 * operation can genuinely be gone by the time a broadcast arrives, because a
	 * successful finalization deletes it, and the caller's remedy is to file the
	 * transaction as a new operation instead. Reporting nothing left the caller
	 * unable to tell that apart from success, so a replacement whose operation
	 * had just finalized was recorded NOWHERE while being on chain.
	 */
	function addTransactionToOperation(
		operationId: string,
		transaction: TrackedTransaction<TransactionMetadata, TxSource>,
	): boolean {
		const accountData = store.get();
		if (accountData) {
			const currentData = accountData.get();
			if (currentData?.status !== 'ready') {
				throw new Error(`accountData not ready`);
			}

			// Check if operation exists
			const operation = currentData.data.operations[operationId];
			if (!operation) {
				return false;
			}

			accountData.patchItem('operations', operationId, (op) => ({
				...op,
				attempts: [...op.attempts, attemptOf(transaction)],
			}));
			return true;
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
		updateOperationFromKnownTransaction,
		updateOperationFromTransactionStateUpdated,
	};
}

export type MultiAccountDataStore = ReturnType<typeof createAccountData>;
