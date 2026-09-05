/**
 * WHICH OPERATION A REPLACEMENT BELONGS TO, for the length of one send.
 *
 * The resubmit path needs the broadcast handler to attach the new transaction
 * to the EXISTING operation instead of filing a new one. It used to say so by
 * stamping an `operationId` into the tracker's METADATA, which the handler then
 * branched on. Metadata is "whatever your application says the transaction
 * MEANS"; an operation id is plumbing. It is the same mistake `source` was
 * introduced to fix, and it ended up persisted in every resubmitted record.
 *
 * So the link is made here instead: the resubmit records `from:nonce` before
 * sending, the broadcast handler reads it and deletes it. NOTHING IS PERSISTED
 * because nothing needs to be: the window is bounded by the send itself, and an
 * entry that outlives it is swept by {@link forgetResubmitTarget}.
 *
 * WHY NOT LOOK `(from, nonce)` UP IN THE STORE INSTEAD, and skip the map: it
 * would silently attach CANCELLATIONS too, and a cancel MUST stay a separate
 * operation. A cancel reuses the stuck transaction's nonce by design, so it
 * matches the same key; attaching it would make the stuck operation report the
 * cancel's Success, and `updateOperationFromTransactionStateUpdated` deletes an
 * operation that reports final success. The stuck transaction the user was
 * trying to get rid of would therefore announce that it SUCCEEDED and vanish
 * from their list, which is the exact opposite of what happened. An explicit
 * marker written only by the resubmit path cannot make that mistake, because
 * the cancel path simply does not write one.
 */

/** Operation key by `from:nonce`, lowercased so two spellings cannot miss. */
const pendingResubmits = new Map<string, string>();

function correlationKey(from: `0x${string}`, nonce: number): string {
	// The address is lowercased because the two ends can disagree on casing: the
	// stored operation may carry a checksummed address while the tracker reports
	// the provider's lowercase one. Same account, two strings, and a miss here
	// would silently file a replacement as a brand new operation.
	return `${from.toLowerCase()}:${nonce}`;
}

/**
 * Declare that the very next broadcast at this `(from, nonce)` is a replacement
 * for `operationKey`. Call it immediately before the send, never speculatively.
 */
export function rememberResubmitTarget(params: {
	from: `0x${string}`;
	nonce: number;
	operationKey: string;
}): void {
	pendingResubmits.set(
		correlationKey(params.from, params.nonce),
		params.operationKey,
	);
}

/**
 * The operation a just-broadcast transaction replaces, consumed.
 *
 * `undefined` means "file a new operation", which is the right answer for every
 * ordinary send and for a cancel.
 */
export function takeResubmitTarget(params: {
	from: `0x${string}`;
	nonce: number | undefined;
}): string | undefined {
	if (params.nonce === undefined) return undefined;
	const key = correlationKey(params.from, params.nonce);
	const operationKey = pendingResubmits.get(key);
	if (operationKey !== undefined) pendingResubmits.delete(key);
	return operationKey;
}

/**
 * Drop a marker whose send did not reach the broadcast handler (it threw, or
 * the user rejected it). Without this a rejected resubmit would leave the
 * marker behind, and the NEXT unrelated send at the same nonce would be
 * attached to an operation it has nothing to do with.
 */
export function forgetResubmitTarget(params: {
	from: `0x${string}`;
	nonce: number;
}): void {
	pendingResubmits.delete(correlationKey(params.from, params.nonce));
}
