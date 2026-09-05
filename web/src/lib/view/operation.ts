import type {OnchainOperation} from '$lib/account/AccountData';
import type {TransactionIntentState} from '@etherkit/tx-observer';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/**
 * Semantic status of an operation, derived from its transaction intent state.
 * Components map the `kind` to an icon; `label`/`variant` are ready to render.
 */
export type OperationStatusKind =
	'pending' | 'notFound' | 'dropped' | 'success' | 'failed' | 'unknown';

export type OperationStatusInfo = {
	kind: OperationStatusKind;
	label: string;
	variant: BadgeVariant;
};

/**
 * Display name for an operation from its metadata discriminated union.
 * @param fallback name to use for unrecognised metadata (varies by surface).
 */
export function getOperationName(
	op: OnchainOperation,
	fallback = 'Unknown Operation',
): string {
	const metadata = op.metadata;
	if (metadata.type === 'functionCall') return metadata.functionName;
	if (metadata.type === 'unknown') return metadata.name;
	return fallback;
}

/**
 * Semantic status (kind + label + badge variant) for an operation.
 *
 * Takes the observer's STATE, which is the only thing it reads and is stored on
 * the operation directly. Components pass `operation.state` rather than
 * building an intent to look one field up in it.
 */
export function getOperationStatusInfo(
	state: TransactionIntentState | undefined,
): OperationStatusInfo {
	if (!state || state.inclusion === 'InMemPool') {
		return {kind: 'pending', label: 'Pending', variant: 'secondary'};
	}
	if (state.inclusion === 'NotFound') {
		return {kind: 'notFound', label: 'Not Found', variant: 'destructive'};
	}
	if (state.inclusion === 'Dropped') {
		return {kind: 'dropped', label: 'Dropped', variant: 'destructive'};
	}
	if (state.inclusion === 'Included') {
		return state.outcome === 'Success'
			? {kind: 'success', label: 'Success', variant: 'default'}
			: {kind: 'failed', label: 'Failed', variant: 'destructive'};
	}
	return {kind: 'unknown', label: 'Unknown', variant: 'outline'};
}

/**
 * The primary transaction hash for an operation: the included attempt when
 * known, otherwise the first attempt.
 *
 * Reads `attempts` directly. The UI is showing what THIS app sent, which is
 * exactly what `attempts` is; the observer's view of it adds nothing here.
 */
export function getMainTxHash(
	operation: OnchainOperation,
): `0x${string}` | undefined {
	const attempts = operation.attempts;
	if (attempts.length === 0) return undefined;

	const state = operation.state;
	// ONLY UNDER `attempt`. The other arm is an inclusion proved by an effect on
	// chain that none of our transactions produced (the same action sent from
	// another device, or a resubmission made in the user's wallet), so there is
	// no hash of ours to point at. The fallback below is then correct rather than
	// approximate: the first attempt is what this app sent.
	// `via?`, not `via`, THOUGH THE TYPE SAYS IT IS ALWAYS THERE. This reads
	// data restored from localStorage, where the type is a promise about what we
	// wrote rather than a fact about what is there, and the fallback below is
	// already the right answer for a state that cannot point at an attempt. The
	// alternative is a TypeError thrown during render, which does not degrade to
	// a missing hash: it takes the whole transactions page down with it, the way
	// a single bigint argument once did.
	if (state?.inclusion === 'Included' && state.via?.kind === 'attempt') {
		return attempts[state.via.attemptIndex]?.hash;
	}
	return attempts[0]?.hash;
}

/**
 * Is THIS attempt the one that got included?
 *
 * False for an out-of-band inclusion, which is the point: no attempt of ours
 * won it, so marking one would be a claim the state does not make.
 */
export function isIncludedAttempt(
	state: TransactionIntentState | undefined,
	index: number,
): boolean {
	return (
		state?.inclusion === 'Included' &&
		// Optional for the same reason as in `getMainTxHash`: a stored state that
		// cannot name an attempt marks none, rather than throwing mid-render.
		state.via?.kind === 'attempt' &&
		state.via.attemptIndex === index
	);
}

/** 'Success' | 'Failure' once included, otherwise null. */
export function getTransactionResult(
	state: TransactionIntentState | undefined,
): string | null {
	if (state?.inclusion === 'Included') return state.outcome;
	return null;
}

/**
 * Earliest broadcast time (ms) across an operation's attempts, or null when
 * none.
 */
export function getEarliestBroadcastMs(
	operation: OnchainOperation,
): number | null {
	const attempts = operation.attempts;
	if (attempts.length === 0) return null;
	return attempts.reduce<number | null>((min, attempt) => {
		if (!attempt.broadcastTimestampMs) return min;
		return min === null || attempt.broadcastTimestampMs < min
			? attempt.broadcastTimestampMs
			: min;
	}, null);
}

/**
 * TWO CLOCKS, TWO UNITS, AND NOTHING CONVERTS BETWEEN THEM IMPLICITLY.
 *
 * `broadcastTimestampMs` is OUR clock, in milliseconds: when this browser
 * handed the transaction to the wallet. `blockTimestamp` is the CHAIN'S, in
 * seconds: when the block that included it was mined. They are different
 * quantities from different sources, so each gets its own named formatter and
 * neither takes a bare number that could be the other.
 *
 * The pair replaces a live bug. `state.final` used to hold the inclusion
 * block's timestamp and was rendered as "Block {final}", so the UI printed a
 * ten-digit unix timestamp labelled as a block number. Finality is now the
 * boolean it always meant, and the timestamp is shown as a time.
 */
export function formatBroadcastTime(
	broadcastTimestampMs: number | null | undefined,
): string | null {
	if (!broadcastTimestampMs) return null;
	return new Date(broadcastTimestampMs).toLocaleString();
}

export function formatBlockTime(
	blockTimestampSeconds: number | null | undefined,
): string | null {
	if (!blockTimestampSeconds) return null;
	// The one place the units meet, spelled out: chain seconds -> Date's ms.
	return new Date(blockTimestampSeconds * 1000).toLocaleString();
}

/** The inclusion block's timestamp (chain seconds), when there is one. */
export function getBlockTimestamp(
	state: TransactionIntentState | undefined,
): number | undefined {
	return state?.inclusion === 'Included' ? state.blockTimestamp : undefined;
}

/**
 * An operation's attempts, most recently broadcast first.
 *
 * Returns a copy: `attempts` is store-owned, and sorting it in place would
 * mutate persisted data from a render.
 */
export function sortAttemptsNewestFirst<
	T extends {broadcastTimestampMs: number},
>(attempts: readonly T[]): T[] {
	return [...attempts].sort(
		(a, b) => (b.broadcastTimestampMs || 0) - (a.broadcastTimestampMs || 0),
	);
}

/**
 * Sort operation ids newest-first. Ids are generated from the clock (numeric
 * timestamps), so compare numerically. Returns a copy so the store-owned array
 * is never mutated.
 */
export function sortOperationIdsDescending(ids: string[]): string[] {
	return [...ids].sort((a, b) => Number(b) - Number(a));
}

/**
 * Count operations that should surface in the pending badge: everything except
 * transactions that are successfully included but not yet final (those are
 * removed from the store once final, so counting them would over-report).
 */
export function countPendingOperations(
	operations: Record<string, OnchainOperation>,
): number {
	let count = 0;
	for (const id of Object.keys(operations)) {
		// Read straight off the record: the observer's state is stored on the
		// operation, and building a whole intent to ask one question about it
		// would be ceremony.
		const state = operations[id].state;
		if (state?.inclusion === 'Included' && state?.outcome === 'Success') {
			continue;
		}
		count++;
	}
	return count;
}

/**
 * Badge variant for a raw inclusion status string (used by the details view,
 * which renders the raw inclusion string rather than the semantic label).
 */
export function getInclusionBadgeVariant(status: string): BadgeVariant {
	switch (status) {
		case 'NotFound':
		case 'Dropped':
			return 'destructive';
		case 'Included':
			return 'default';
		case 'InMemPool':
		default:
			return 'secondary';
	}
}

/**
 * The account an operation was sent FROM.
 *
 * Read off the CALL rather than tracked separately, because `from` is already
 * the one fact that says whose transaction this is. It is what selects the
 * executor for a resubmit or a cancel, so filtering on it means "the list you
 * can see" and "the button that can act on it" agree by construction.
 *
 * One per OPERATION, not per attempt: the record hoists `from` into `call`
 * because the replacement path's premise is that one route owns the nonce slot,
 * so every attempt of an operation shares its sender.
 */
export function operationSender(op: OnchainOperation): `0x${string}` {
	return op.call.from;
}

/**
 * Split operations by which account sent them.
 *
 * Provided because one list is the right STORAGE (operations belong to the
 * player, whichever key signed) but not always the right DISPLAY. A game sends
 * two transactions per round forever from its signer, which would bury the rare
 * transactions the user made themselves; such a game shows them apart, while a
 * simple app shows one list and never calls this.
 *
 * Pure, and taking a snapshot rather than a store, so the caller decides how to
 * make it reactive.
 */
export function partitionOperationsBySender(
	operations: readonly [string, OnchainOperation][],
	sender: `0x${string}` | undefined,
): {
	from: [string, OnchainOperation][];
	others: [string, OnchainOperation][];
} {
	const wanted = sender?.toLowerCase();
	const from: [string, OnchainOperation][] = [];
	const others: [string, OnchainOperation][] = [];
	for (const entry of operations) {
		const isMatch =
			wanted !== undefined &&
			operationSender(entry[1]).toLowerCase() === wanted;
		(isMatch ? from : others).push(entry);
	}
	return {from, others};
}
