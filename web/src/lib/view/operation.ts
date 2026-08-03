import type {OnchainOperation} from '$lib/account/AccountData';
import type {TransactionIntent} from '@etherkit/tx-observer';

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
 * Semantic status (kind + label + badge variant) for an operation's intent.
 */
export function getOperationStatusInfo(
	intent: TransactionIntent,
): OperationStatusInfo {
	const state = intent.state;

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
		return state.status === 'Success'
			? {kind: 'success', label: 'Success', variant: 'default'}
			: {kind: 'failed', label: 'Failed', variant: 'destructive'};
	}
	return {kind: 'unknown', label: 'Unknown', variant: 'outline'};
}

/**
 * The primary transaction hash for an operation: the included attempt when
 * known, otherwise the first attempt.
 */
export function getMainTxHash(
	intent: TransactionIntent,
): `0x${string}` | undefined {
	if (intent.transactions.length === 0) return undefined;

	const state = intent.state;
	if (state?.inclusion === 'Included' && state.attemptIndex !== undefined) {
		return intent.transactions[state.attemptIndex]?.hash;
	}
	return intent.transactions[0]?.hash;
}

/** 'Success' | 'Failure' once included, otherwise null. */
export function getTransactionResult(intent: TransactionIntent): string | null {
	const state = intent.state;
	if (state?.inclusion === 'Included') return state.status;
	return null;
}

/**
 * Earliest broadcast time (ms) across an intent's attempts, or null when none.
 */
export function getEarliestBroadcastMs(
	intent: TransactionIntent,
): number | null {
	const txs = intent.transactions;
	if (txs.length === 0) return null;
	return txs.reduce<number | null>((min, tx) => {
		if (!tx.broadcastTimestampMs) return min;
		return min === null || tx.broadcastTimestampMs < min
			? tx.broadcastTimestampMs
			: min;
	}, null);
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
		const state = operations[id].transactionIntent.state;
		if (state?.inclusion === 'Included' && state?.status === 'Success') {
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
