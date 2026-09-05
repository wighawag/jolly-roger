import {get} from 'svelte/store';
import type {AccountStore, TypedDeployments} from '$lib/core/connection/types';
import {
	readAllStoredOperations,
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
 * rather than read as "nothing recorded". Storage covers everything else,
 * including the ordinary case of a reload where no wallet has connected yet.
 *
 * Before that second source existed, a reload with a locked wallet could not
 * answer the question at all, so the app fell back to guessing from the chain
 * and told users a transaction might have been sent while it sat in their list.
 * Reported exactly that way: "no reconciliation happens on reload".
 *
 * THE SENDER IS NOT THE SCOPE, and conflating the two was this reader's own
 * version of the same bug. It used to look the sender up as though they owned a
 * list: connected account, read the live store; anyone else, read storage under
 * THEIR address. That was accurate exactly while one account sent everything.
 * It stopped being true with the local signer and again with the payment rail,
 * both of whose transactions are filed under the PLAYER (account data is keyed
 * by the authenticated account, see `account/connectors.ts`), so looking them up
 * under their own address read a scope that is never written and answered NOT
 * KNOWN about a transaction the user can see in their list.
 *
 * So the scope is no longer guessed at all. Every stored list is searched and
 * the answer is filtered by `from`, which is exact rather than approximate: a
 * nonce belongs to the account that signs, so "sender S at nonce N" names one
 * transaction slot on this chain whoever's list recorded it.
 *
 * `undefined` still means NOT KNOWN, and is still distinct from an empty list.
 * It is returned when something that could hold the answer could not be read:
 * account data still restoring, or a stored envelope that would not parse.
 */

/**
 * Every nonce this SENDER has a recorded attempt at, across every operation.
 *
 * FILTERED BY `from`, and that is the whole point of the parameter. A nonce is
 * per account, and an operation list is not: account data is keyed by the
 * authenticated player and holds whatever any of this app's senders did on their
 * behalf, each transaction carrying the address that signed it. Pooling them
 * meant the signer's nonce 4 could answer a question about the account's nonce
 * 4, and `reconcileRequest` checks this list BEFORE it compares against the node
 * and returns `recorded` outright, at which point the ledger deletes the record
 * as settled. So the failure was silent and in the dangerous direction: a
 * request nobody could account for, dropped because a different account happened
 * to have used that number.
 *
 * STRICT about a missing `from`: an attempt that does not say who sent it is not
 * evidence about this sender. Operations carry `from` from the moment they are
 * filed (`addOperationFromTrackedTransaction`) and the observer's own
 * `BroadcastedTransaction` declares it readonly-required, so it survives the
 * merge in `updateOperationFromTransactionStateUpdated` and there is no ordinary
 * path that produces one without it.
 *
 * `from` IS NOW PER OPERATION, not per attempt. The record hoists it into
 * `call` because the replacement path's premise is that one route owns the
 * nonce slot for the whole operation, so every attempt under an operation
 * shares its sender and the filter moves up one level. The strictness above is
 * unchanged: an operation that does not say who sent it is still not evidence
 * about this sender.
 *
 * Reads `attempts` DIRECTLY rather than through the intent projection: the
 * question is which nonces this app has dispatched, which is a fact about what
 * was sent, not about what the observer has since made of it.
 */
export function collectRecordedNonces(
	operations: Record<string, OnchainOperation>,
	sender: `0x${string}`,
): number[] {
	const from = sender.toLowerCase();
	const nonces: number[] = [];
	for (const operation of Object.values(operations)) {
		const signer = operation.call?.from;
		if (typeof signer !== 'string') continue;
		if (signer.toLowerCase() !== from) continue;
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

	/**
	 * The connected player's own list, which storage may not have caught up with.
	 *
	 * `{}` when nobody is connected: there is no live list to be behind, so
	 * storage is the whole of the answer and an empty result there is a real
	 * empty. `undefined` only when a list EXISTS and we could not read it yet,
	 * which is genuinely not knowing rather than knowing nothing.
	 */
	function liveOperations(): Promise<
		Record<string, OnchainOperation> | undefined
	> {
		if (!get(account)) return Promise.resolve({});
		if (accountData.isReady()) return Promise.resolve(get(operations));

		return new Promise((resolve) => {
			let settled = false;
			let unsubscribe: (() => void) | undefined;

			const finish = (value: Record<string, OnchainOperation> | undefined) => {
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
				// A disconnect while we wait is an answer too: there is no longer a
				// live list to be waiting for, and storage still holds what it held.
				if (!get(account)) {
					finish({});
					return;
				}
				if (!accountData.isReady()) return;
				finish(current);
			});

			if (settled) unsubscribe?.();
		});
	}

	return async (address) => {
		const live = await liveOperations();
		if (live === undefined) return undefined;

		const stored = readAllStoredOperations({deployments, scopeAddress});
		// ANY unread list makes the whole answer NOT KNOWN, even though the nonces
		// we did gather are perfectly good. This reader answers with a LIST and is
		// never told which nonce is being asked about, so it cannot say "the one you
		// want is in here" while admitting the rest is incomplete: a caller looking
		// for a nonce that is missing could not tell a real absence from a list we
		// failed to finish. Reporting NOT KNOWN costs a fallthrough to the nonce
		// comparison; the alternative tells a user their transaction was never
		// recorded on the strength of a file we could not open.
		if (!stored.complete) return undefined;

		// Deduped, because the connected player's list is in both sources: storage
		// lags the live store by synqable's debounce, so the two overlap rather
		// than one superseding the other.
		const nonces = new Set<number>();
		for (const source of [live, ...stored.operations]) {
			for (const nonce of collectRecordedNonces(source, address)) {
				nonces.add(nonce);
			}
		}
		return [...nonces];
	};
}
