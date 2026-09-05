import {get} from 'svelte/store';
import type {AccountStore, TypedDeployments} from '$lib/core/connection/types';
import {
	readStoredOperations,
	type MultiAccountDataStore,
	type OnchainOperation,
} from './AccountData';

/**
 * Which nonces the app has ALREADY recorded, for reconciling in-flight requests
 * (see `core/transaction/in-flight`).
 *
 * This is the input that turns "a transaction landed at this nonce" into the
 * quiet answer "and you can see it in your list", which is the difference
 * between a warning that means something and one users learn to dismiss.
 *
 * TWO SOURCES, because the question outlives the session. The live store is
 * authoritative for the account that is CONNECTED: it may hold writes that have
 * not reached storage yet, and it has a loading state that must be waited out
 * rather than read as "nothing recorded". For any OTHER account, including the
 * ordinary case of a reload where no wallet has connected yet, storage is read
 * directly (see `readStoredOperations`): the key is derived from the chain, the
 * deployment and the address, all of which the in-flight record carries.
 *
 * Before that second source existed, a reload with a locked wallet could not
 * answer the question at all, so the app fell back to guessing from the chain
 * and told users a transaction might have been sent while it sat in their list.
 * Reported exactly that way: "no reconciliation happens on reload".
 *
 * `undefined` still means NOT KNOWN, and is still distinct from an empty list.
 */

/**
 * Every nonce across every attempt of every recorded operation.
 *
 * Reads `attempts` DIRECTLY rather than through the intent projection: the
 * question is which nonces this app has dispatched, which is a fact about what
 * was sent, not about what the observer has since made of it.
 */
export function collectRecordedNonces(
	operations: Record<string, OnchainOperation>,
): number[] {
	const nonces: number[] = [];
	for (const operation of Object.values(operations)) {
		for (const attempt of operation.attempts ?? []) {
			if (typeof attempt.nonce === 'number') nonces.push(attempt.nonce);
		}
	}
	return nonces;
}

export type RecordedNonceReader = (
	address: `0x${string}`,
) => Promise<readonly number[] | undefined>;

/**
 * Read the recorded nonces for an address, waiting out the restore.
 *
 * `undefined` means NOT KNOWN and is returned for an address that is not the
 * account whose data we hold, or when the restore has not finished within
 * `timeoutMs`. Never an empty array standing in for either.
 */
export function createRecordedNonceReader(params: {
	accountData: MultiAccountDataStore;
	account: AccountStore;
	/** Identifies the storage scope, for reading an account we are not on. */
	deployments: TypedDeployments;
	scopeAddress: `0x${string}`;
	/**
	 * How long to wait for account data to be restored. Generous: this runs
	 * during reconciliation, where nothing is on screen waiting for it, and
	 * giving up early costs the quiet answer.
	 */
	timeoutMs?: number;
}): RecordedNonceReader {
	const {
		accountData,
		account,
		deployments,
		scopeAddress,
		timeoutMs = 10_000,
	} = params;

	const operations = accountData.watchField('operations');

	function readNow(): number[] {
		return collectRecordedNonces(get(operations));
	}

	return async (address) => {
		const current = get(account);
		if (!current || current.toLowerCase() !== address.toLowerCase()) {
			// Not the connected account, or nothing is connected at all. Storage
			// still knows, and this is the common case on a reload.
			const stored = readStoredOperations({
				deployments,
				scopeAddress,
				account: address,
			});
			return stored ? collectRecordedNonces(stored) : undefined;
		}

		if (accountData.isReady()) return readNow();

		return new Promise<readonly number[] | undefined>((resolve) => {
			let settled = false;
			let unsubscribe: (() => void) | undefined;

			const finish = (value: readonly number[] | undefined) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe?.();
				resolve(value);
			};

			const timer = setTimeout(() => finish(undefined), timeoutMs);

			// `watchField` also emits when the store's own status changes, which is
			// precisely when "not ready" becomes "ready" (see watchOverlayOperation,
			// which re-reads readiness on every emission for the same reason).
			unsubscribe = operations.subscribe((current) => {
				if (!accountData.isReady()) return;
				// The account can change while we wait; data for somebody else is not
				// an answer about this address.
				const now = get(account);
				if (!now || now.toLowerCase() !== address.toLowerCase()) {
					finish(undefined);
					return;
				}
				finish(collectRecordedNonces(current));
			});

			if (settled) unsubscribe?.();
		});
	};
}
