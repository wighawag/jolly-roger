/**
 * In-flight transaction requests: what the app knows between handing a
 * transaction to the wallet and hearing back (ADR-0004, `work` branch).
 *
 * THE HOLE THIS FILLS. An operation is recorded only on
 * `transaction:broadcasted` (`account/connectors.ts`, `AccountData.ts`). Between
 * dispatching `eth_sendTransaction` and receiving the hash the app has NO record
 * of a transaction that may already be in the mempool, so a reload, a tab crash
 * or a user who stops waiting leaves the app believing nothing happened while
 * something may well have. For an app whose next step depends on the first one
 * (a commit expecting its reveal) that is not untidiness, it is data loss.
 *
 * So a record is persisted BEFORE dispatch and settled afterwards, and until it
 * is settled the outcome is UNKNOWN. Never failed, never rejected: the app must
 * not record a rejection it did not observe. A rejection is only ever written
 * when the wallet actually said so (EIP-1193 code 4001, see ./user-rejection).
 *
 * Reconciliation is by NONCE, in the same terms `core/connection/nonce-cache.ts`
 * already uses (`isStrandedNonce`, `nodeNonceReader`): the node's next expected
 * nonce for the sender is read just before dispatch and compared against it
 * afterwards. That comparison cannot prove which transaction consumed a nonce,
 * only that one did, and the words below are chosen so nothing downstream can
 * quietly upgrade "a transaction landed" into "your transaction landed".
 *
 * Pure: no storage, no clock, no RPC. The store in ./in-flight-store supplies
 * all three, which is what keeps the rules here testable without a browser.
 */

/** What the request was for, in as much detail as is worth persisting. */
export type InFlightIntent = {
	/** One line, shown to the user. e.g. `setMessage on GreetingsRegistry`. */
	description: string;
	/** Contract or recipient, when there is one. */
	to?: `0x${string}`;
	/** Contract function, when the request came from `writeContract`. */
	functionName?: string;
};

/**
 * A transaction request the app has dispatched and not yet seen the end of.
 *
 * Written to storage before the wallet is asked, so it survives everything that
 * can happen next, including the things no dialog survives.
 */
export type InFlightRequest = {
	/** Ours, not the chain's: there is no hash yet, that is the whole point. */
	id: string;
	/** Who was asked to sign. Reconciliation is per account. */
	account: `0x${string}`;
	chainId: number;
	/**
	 * The node's next expected nonce for `account`, read JUST BEFORE dispatch.
	 *
	 * The baseline the whole reconciliation rests on: if the node has moved past
	 * it, a transaction from this account has been mined that was not there when
	 * we asked. `undefined` when the node could not be read in time, which costs
	 * us the comparison but never the record.
	 */
	nonce: number | undefined;
	intent: InFlightIntent;
	/** When the request was dispatched (ms since epoch). */
	requestedAt: number;
};

/**
 * What reconciliation could establish. There is no `failed` and no `rejected`
 * here on purpose: those are things the app can only ever OBSERVE, and a record
 * that reaches reconciliation is by definition one it did not observe.
 */
export type InFlightOutcome =
	/**
	 * The app already holds an operation at this nonce for this account, so the
	 * broadcast did happen and was recorded; the record is redundant. This is the
	 * crash-between-broadcast-and-settle case, and it must be silent: nagging
	 * about a transaction the user can already see in their list is noise that
	 * teaches them to ignore the warning that matters.
	 */
	| {status: 'recorded'; nonce: number}
	/**
	 * The nonce this request would have used has been consumed on chain. A
	 * transaction from this account landed. It is PROBABLY this one, and the
	 * words stop there: nothing in a nonce identifies which transaction took it,
	 * so the user is told what is true and pointed at their transaction list.
	 */
	| {status: 'nonce-consumed'; nonce: number}
	/**
	 * OBSERVED, not deduced: the transaction was broadcast, we have its hash, and
	 * the app could not file it as an operation because account data was not
	 * available (the account went away between dispatch and answer). The strongest
	 * thing this type can say, and the only one carrying a hash.
	 *
	 * It exists so that losing account data costs the user a line in their
	 * transaction list rather than the knowledge that they sent something. Nothing
	 * deduces this and reconciliation never overwrites it: a nonce comparison
	 * cannot improve on having watched it happen.
	 */
	| {status: 'broadcast-not-recorded'; hash: `0x${string}`; nonce?: number}
	/**
	 * Still unknown, which is the honest answer and the default.
	 *
	 * - `nonce-free`: nothing from this account has landed since. The request may
	 *   still be sitting in the wallet, or the user may have rejected it where we
	 *   could not see. These two are indistinguishable from here, so we do not
	 *   distinguish them.
	 * - `nonce-behind`: the node's nonce is BELOW our baseline, so the chain is
	 *   not the one we asked (a restarted dev node). Comparing further would be
	 *   comparing against a different history. See `nonce-cache.ts`.
	 * - `no-baseline`: we could not read the node before dispatch.
	 * - `unreadable`: we cannot read the node now.
	 */
	| {
			status: 'unknown';
			reason: 'nonce-free' | 'nonce-behind' | 'no-baseline' | 'unreadable';
	  };

/**
 * Decide what happened to one in-flight request.
 *
 * @param nodeNonce      The node's `pending` transaction count for the sender NOW
 *   (its next expected nonce), or `undefined` when it could not be read.
 * @param recordedNonces Nonces of transactions the app has already recorded for
 *   this account, i.e. broadcasts it DID see. Checked first, because "the app
 *   already knows about this" is a stronger and quieter answer than anything the
 *   nonce comparison can give. `undefined` means NOT KNOWN, which is a third
 *   answer and not an empty list: account data is restored per account and
 *   asynchronously, so a record belonging to an account we have no data for must
 *   fall through to the nonce comparison rather than be told, on no evidence,
 *   that the app never saw it. Collapsing the two is the same mistake ADR-0004
 *   records for content overlays.
 */
export function reconcileRequest(params: {
	request: InFlightRequest;
	nodeNonce: number | undefined;
	recordedNonces: readonly number[] | undefined;
}): InFlightOutcome {
	const {request, nodeNonce, recordedNonces} = params;

	if (request.nonce === undefined) {
		return {status: 'unknown', reason: 'no-baseline'};
	}

	if (recordedNonces?.includes(request.nonce)) {
		return {status: 'recorded', nonce: request.nonce};
	}

	if (nodeNonce === undefined) {
		return {status: 'unknown', reason: 'unreadable'};
	}

	if (nodeNonce < request.nonce) {
		return {status: 'unknown', reason: 'nonce-behind'};
	}

	if (nodeNonce > request.nonce) {
		return {status: 'nonce-consumed', nonce: request.nonce};
	}

	return {status: 'unknown', reason: 'nonce-free'};
}

/**
 * Whether an outcome is one the user should be told about.
 *
 * `recorded` is not: the app has the transaction, so there is nothing to report.
 * Everything else is, including every flavour of unknown, because "we do not
 * know whether this was sent" is precisely the thing worth saying.
 */
export function isWorthReporting(outcome: InFlightOutcome): boolean {
	return outcome.status !== 'recorded';
}

/**
 * The sentence to show for an outcome.
 *
 * Here rather than in a component because the wording IS the feature: this is
 * the app admitting what it does not know, and every variant has to stay
 * truthful under review. A component that composed these strings itself would
 * be one edit away from claiming a transaction failed.
 */
export function describeOutcome(outcome: InFlightOutcome): string {
	switch (outcome.status) {
		case 'recorded':
			return 'This transaction was sent and is in your transaction list.';
		case 'nonce-consumed':
			return 'A transaction from this account has since been mined with the nonce this request would have used, so this request was most likely sent. Check your transaction list and your wallet before trying again.';
		case 'broadcast-not-recorded':
			// "One of the requests below" rather than "this one", because the hash is
			// matched to a record by account and nonce, and a record whose baseline
			// was never read can only be matched by being the oldest for that
			// account. With two such records the hash can land on the wrong one, so
			// the sentence must not insist on the description shown beside it.
			return `A transaction WAS sent (${outcome.hash}), and it is on chain, but the app could not add it to your transaction list because the account was no longer connected when the wallet answered. Look it up by that hash before sending anything again.`;
		case 'unknown':
			switch (outcome.reason) {
				case 'nonce-free':
					return 'We never saw an answer from your wallet. Nothing has been sent from this account since, so the request may still be waiting in your wallet, or you may have declined it. Approving it later would still send it.';
				case 'nonce-behind':
					return 'We cannot tell: the node reports fewer transactions from this account than when the request was made, which usually means the chain was reset. Check your wallet.';
				case 'no-baseline':
					return 'We never saw an answer from your wallet, and we could not read the chain when the request was made, so we cannot tell whether it was sent. Check your wallet and your transaction list.';
				case 'unreadable':
					return 'We never saw an answer from your wallet, and we cannot reach the chain to check. Try again once you are back online.';
			}
	}
}

/**
 * Whether a stored value is a request we can still use.
 *
 * Storage outlives code, so a record written by an older version (or by a hand
 * edit, or by another app on the same origin) has to be recognisably not-ours
 * and dropped rather than reconciled against. Dropping is safe here in a way it
 * would not be elsewhere: a record we cannot read is a record we could not have
 * told the user anything true about.
 */
export function isInFlightRequest(value: unknown): value is InFlightRequest {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== 'string') return false;
	if (typeof record.account !== 'string') return false;
	if (typeof record.chainId !== 'number') return false;
	if (record.nonce !== undefined && typeof record.nonce !== 'number')
		return false;
	if (typeof record.requestedAt !== 'number') return false;
	const intent = record.intent as Record<string, unknown> | undefined;
	if (!intent || typeof intent !== 'object') return false;
	return typeof intent.description === 'string';
}
