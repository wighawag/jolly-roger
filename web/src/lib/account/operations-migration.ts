import type {
	BroadcastedTransactionState,
	TransactionIntentState,
} from '@etherkit/tx-observer';
import type {IntendedGasParameters} from '@etherkit/viem-tx-tracker';
import type {InternalStorage} from 'synqable';
import type {OnchainOperation, OperationAttempt, Schema} from './AccountData';

/**
 * ONE MIGRATION, FOR TWO CHANGES THAT LANDED TOGETHER.
 *
 * `@etherkit/tx-observer@0.2.0` rewrote every stored operation's state at the
 * same time as the record around it was restructured, so users pay for one
 * rewrite of their localStorage rather than two of the same records.
 *
 * WHAT IT CONVERTS, from a record written by the previous build:
 *
 *   {metadata: {...meta, operationId?, tx}, transactionIntent: {transactions, state}}
 *     -> {metadata, call, attempts, state}
 *
 * - `metadata.tx` splits into `call` (from/to/value/data/chainId/source) and
 *   the dispatch facts of one attempt (hash/nonce/broadcastTimestampMs/
 *   gasParameters/txType).
 * - `metadata` keeps only the transaction metadata: no `tx`, and no
 *   `operationId`, which is plumbing that no longer travels in metadata.
 * - each `transactionIntent.transactions[i].state` moves onto the attempt with
 *   the same HASH; an attempt with no matching entry keeps `state` undefined.
 * - the intent state is rewritten for 0.2.0: `status` -> `outcome`,
 *   `final: number | undefined` -> `final: boolean` plus `blockTimestamp`
 *   (0.1.0 stored the inclusion block's timestamp in `final` and used its mere
 *   presence as the finality flag), `attemptIndex: n` -> `via: {kind:
 *   'attempt', attemptIndex: n}`.
 * - `nonceObserved` is absent, which the observer reads as false. Correct: the
 *   previous build never observed a nonce off the chain, and inventing a `true`
 *   here would let a supplied nonce declare a transaction Dropped.
 * - a record with no `source` keeps having none. `isKnownSource` already covers
 *   pre-source records and the replacement path falls back correctly, so
 *   fabricating a route would be strictly worse than the gap.
 *
 * THIS CAN BE DELETED A RELEASE AFTER IT SHIPS. Operations are retained for
 * `PUBLIC_OPERATION_RETENTION_DAYS` (default 7) and then dropped, so a week
 * after this is in users' hands there is no v1 record left to convert. Delete
 * this file, `readStoredOperations`'s call to it, and the `migrations` entry;
 * keep `schemaVersion` where it is.
 */
export const OPERATIONS_SCHEMA_VERSION = 2;

/** A 0.1.0-era stored record, read defensively: it is data, not a type. */
type LegacyState = {
	inclusion?: string;
	status?: string;
	final?: number;
	attemptIndex?: number;
};

type LegacyTransaction = {
	hash?: string;
	nonce?: number;
	broadcastTimestampMs?: number;
	state?: LegacyState;
};

type LegacyTx = {
	hash?: string;
	from?: string;
	to?: string | null;
	value?: bigint;
	data?: string;
	chainId?: number;
	nonce?: number;
	broadcastTimestampMs?: number;
	gasParameters?: IntendedGasParameters;
	txType?: string;
	source?: unknown;
};

type LegacyOperation = {
	metadata?: Record<string, unknown> & {tx?: LegacyTx; operationId?: string};
	transactionIntent?: {
		transactions?: LegacyTransaction[];
		state?: LegacyState;
		expectedUpdate?: unknown;
	};
	/**
	 * SYNQABLE'S, NOT OURS, and it must survive. It is the retention deadline
	 * the store sweeps on, so an upgrade that dropped it would either resurrect
	 * finished operations forever or have them swept immediately, depending on
	 * how the sweep reads a missing one. Either way the migration would be
	 * deciding retention, which is not its job.
	 */
	deleteAt?: number;
};

/** A record already in the new shape, so a re-run is a no-op rather than a loss. */
function isAlreadyMigrated(operation: unknown): boolean {
	return (
		!!operation &&
		typeof operation === 'object' &&
		'attempts' in (operation as Record<string, unknown>)
	);
}

/** The 0.2.0 state of ONE transaction, from the 0.1.0 one. */
function upgradeTransactionState(
	legacy: LegacyState | undefined,
): BroadcastedTransactionState | undefined {
	if (!legacy?.inclusion) return undefined;

	if (legacy.inclusion === 'Included') {
		return {
			inclusion: 'Included',
			// 'Success' unless it explicitly failed: the field is the only record
			// of the outcome and an included transaction has exactly two.
			outcome: legacy.status === 'Failure' ? 'Failure' : 'Success',
			final: legacy.final !== undefined,
			// The number that used to live in `final` was always the inclusion
			// block's timestamp, in the chain's own SECONDS. It keeps that unit
			// here; nothing converts it against `broadcastTimestampMs`.
			...(legacy.final !== undefined ? {blockTimestamp: legacy.final} : {}),
		};
	}
	if (legacy.inclusion === 'Dropped') {
		// No blockTimestamp on this arm: there is no inclusion block to stamp.
		return {inclusion: 'Dropped', final: legacy.final !== undefined};
	}
	if (legacy.inclusion === 'InMemPool' || legacy.inclusion === 'NotFound') {
		return {inclusion: legacy.inclusion};
	}
	// An inclusion this build does not know: drop the state rather than store a
	// shape nothing can read. The observer re-derives it on the next tick.
	return undefined;
}

/**
 * The 0.2.0 state of the INTENT.
 *
 * `attemptIndex` is resolved through the HASH it pointed at rather than copied
 * as a number: it indexed the old `transactions` array, and the new `attempts`
 * array is not required to be in that order. A number carried across blind
 * would silently name a different transaction as the winner.
 */
function upgradeIntentState(
	legacy: LegacyState | undefined,
	legacyTransactions: LegacyTransaction[],
	attempts: OperationAttempt[],
): TransactionIntentState | undefined {
	if (!legacy?.inclusion) return undefined;

	if (legacy.inclusion === 'Included') {
		const winningHash =
			legacy.attemptIndex !== undefined
				? legacyTransactions[legacy.attemptIndex]?.hash
				: undefined;
		const attemptIndex = attempts.findIndex(
			(attempt) => attempt.hash === winningHash,
		);
		if (attemptIndex < 0) {
			// The winner cannot be pointed at, so the inclusion cannot be
			// expressed: 0.2.0's Included arm requires a `via`. Report what is
			// still true (it was seen in the mempool) and let the observer
			// rediscover the rest on its next tick, which costs one poll.
			return {inclusion: 'InMemPool'};
		}
		return {
			inclusion: 'Included',
			outcome: legacy.status === 'Failure' ? 'Failure' : 'Success',
			final: legacy.final !== undefined,
			...(legacy.final !== undefined ? {blockTimestamp: legacy.final} : {}),
			// Always the `attempt` arm: 0.1.0 had no out-of-band detection, so
			// every inclusion it recorded was one of our own transactions.
			via: {kind: 'attempt', attemptIndex},
		};
	}
	if (legacy.inclusion === 'Dropped') {
		return {inclusion: 'Dropped', final: legacy.final !== undefined};
	}
	if (legacy.inclusion === 'InMemPool' || legacy.inclusion === 'NotFound') {
		return {inclusion: legacy.inclusion};
	}
	return undefined;
}

/** One stored operation, from the old shape to the new one. */
export function upgradeOperation(stored: unknown): OnchainOperation {
	if (isAlreadyMigrated(stored)) return stored as OnchainOperation;

	const legacy = (stored ?? {}) as LegacyOperation;
	const tx = legacy.metadata?.tx ?? {};
	const legacyTransactions = legacy.transactionIntent?.transactions ?? [];

	// `tx` and `operationId` come out; everything else IS the metadata. Taken by
	// exclusion rather than by listing the fields to keep, because metadata is a
	// discriminated union the app is free to extend, and a whitelist here would
	// quietly drop a descendant's own fields.
	const {
		tx: _tx,
		operationId: _operationId,
		...metadata
	} = legacy.metadata ?? {};

	const call = {
		from: tx.from as `0x${string}`,
		to: (tx.to ?? null) as `0x${string}` | null,
		value: tx.value ?? 0n,
		data: (tx.data ?? '0x') as `0x${string}`,
		...(tx.chainId !== undefined ? {chainId: tx.chainId} : {}),
		// Absent stays absent: `isKnownSource` reads that as "I do not know which
		// route sent this", which is the truth about a pre-source record.
		...(tx.source !== undefined ? {source: tx.source} : {}),
	} as OnchainOperation['call'];

	// ATTEMPT ORDER FOLLOWS THE OLD `transactions` ARRAY, which is the order the
	// app appended broadcasts in, so a UI that numbers them keeps numbering them
	// the same way across the upgrade.
	const attempts: OperationAttempt[] = legacyTransactions
		.filter((transaction) => !!transaction?.hash)
		.map((transaction) => {
			const dispatched = transaction.hash === tx.hash;
			const state = upgradeTransactionState(transaction.state);
			return {
				hash: transaction.hash as `0x${string}`,
				nonce: transaction.nonce ?? (tx.nonce as number),
				broadcastTimestampMs: transaction.broadcastTimestampMs ?? 0,
				// Only the attempt `metadata.tx` describes has real gas parameters.
				// The others were appended by a resubmit that recorded none, so they
				// get an empty set rather than a borrowed one: the replacement floor
				// takes a maximum, and a borrowed fee would pin it to the wrong
				// number for an attempt that never carried it.
				gasParameters: dispatched ? (tx.gasParameters ?? {}) : {},
				...(dispatched && tx.txType !== undefined ? {txType: tx.txType} : {}),
				...(state !== undefined ? {state} : {}),
			};
		});

	// `metadata.tx` describes a broadcast that never made it into the intent's
	// list (the only shape that produces it is a record written between the two
	// writes). It is still an attempt, and the earliest one.
	if (tx.hash && !attempts.some((attempt) => attempt.hash === tx.hash)) {
		attempts.unshift({
			hash: tx.hash as `0x${string}`,
			nonce: tx.nonce as number,
			broadcastTimestampMs: tx.broadcastTimestampMs ?? 0,
			gasParameters: tx.gasParameters ?? {},
			...(tx.txType !== undefined ? {txType: tx.txType} : {}),
		});
	}

	const expectedUpdate = legacy.transactionIntent?.expectedUpdate;
	const state = upgradeIntentState(
		legacy.transactionIntent?.state,
		legacyTransactions,
		attempts,
	);

	return {
		metadata: metadata as OnchainOperation['metadata'],
		call,
		attempts,
		...(expectedUpdate !== undefined
			? {expectedUpdate: expectedUpdate as OnchainOperation['expectedUpdate']}
			: {}),
		...(state !== undefined ? {state} : {}),
		// Carried verbatim, see LegacyOperation.deleteAt.
		...(legacy.deleteAt !== undefined ? {deleteAt: legacy.deleteAt} : {}),
	};
}

/**
 * The whole synqable envelope, upgraded in place.
 *
 * Takes and returns the ENVELOPE, not the operations map, because that is what
 * `createSyncableStore` hands a migration and what `readStoredOperations`
 * parses off the disk. ONE function for BOTH read paths: the store's own load,
 * and the direct localStorage scan that bypasses it. A scan left on the old
 * function keeps returning pre-migration records that nothing else understands.
 */
export function upgradeStoredOperations(
	oldData: unknown,
): InternalStorage<Schema> {
	const envelope = (oldData ?? {}) as InternalStorage<Schema> & {
		data?: {operations?: Record<string, unknown>};
	};
	const operations = envelope.data?.operations ?? {};

	const upgraded: Record<string, OnchainOperation> = {};
	for (const [id, operation] of Object.entries(operations)) {
		upgraded[id] = upgradeOperation(operation);
	}

	return {
		...envelope,
		$version: OPERATIONS_SCHEMA_VERSION,
		data: {...envelope.data, operations: upgraded},
	} as InternalStorage<Schema>;
}
