/**
 * WHICH SIGNING ROUTE produced a transaction.
 *
 * Stamped by the tx tracker at dispatch (see `source` in
 * `@etherkit/viem-tx-tracker`) and carried verbatim into the stored operation,
 * where it sits beside `from` and `nonce` rather than inside the app's
 * metadata: it is a fact observed at dispatch, not something the app said the
 * transaction means.
 *
 * IT EXISTS SO A STUCK TRANSACTION CAN BE REPLACED. Replacing or cancelling
 * reuses the original nonce, nonces are per-account, so the replacement must be
 * signed by the key that signed the original. `from` names that key but does not
 * say how to reach it, and the route that can reach it is routinely NOT the one
 * currently connected: the local signer needs a sign-in that has not happened
 * yet, and the payment rail is dormant by construction. Searching for the
 * address instead of recording the route was tried and does not work: a locked
 * wallet answers `eth_accounts` with nothing, which is exactly the state a user
 * with a stuck transaction tends to be in.
 *
 * `route` selects WHICH sender to reactivate, deterministically and whether or
 * not it is ready right now. `from` remains the nonce owner and is what
 * validates the choice. The two together are what turn "this came from a
 * different account" into an action.
 */
export type TxSource =
	/** The authenticated account's own wallet, via the app connection. */
	| {route: 'account'; wallet?: WalletIdentity}
	/** The local signer whose key the app holds. No wallet, nothing to reopen. */
	| {route: 'signer'}
	/**
	 * A wallet connected purely to pay, via the payment rail
	 * (see `createPaymentRail`).
	 *
	 * PRESENT ON THIS BRANCH THOUGH NOTHING HERE SENDS FROM IT, for the same
	 * reason `createPaymentRail` is: the rail is an extension point placed
	 * upstream for a descendant. Were this union closed to the two routes this
	 * branch uses, every descendant that takes payments would have to widen a
	 * core type, and would conflict here on every merge. Costing this branch one
	 * unused arm is the cheaper half of that trade.
	 */
	| {route: 'rail'; wallet?: WalletIdentity};

/**
 * THE SAME THREE ROUTES `PayerKind` ALREADY NAMES.
 *
 * `core/transaction/insufficient-funds-view` enumerates `'account' | 'signer' |
 * 'rail' | 'unknown'` to decide which remedy to offer an account that is short.
 * That is this list asked a different question, so it is spelled the same way on
 * purpose: a route added to one and not the other is a transaction that can be
 * sent and then neither replaced nor funded, and two vocabularies for one set of
 * accounts is how that happens without anybody noticing.
 *
 * This list is additionally PERSISTED (see `OnchainOperationMetadata.tx`), so
 * the strings are effectively permanent. Renaming a route makes every stored
 * operation carry one no build recognises, which drops those transactions to the
 * no-source fallback.
 */
export const TX_ROUTES = ['account', 'signer', 'rail'] as const;

/**
 * Enough to reopen a wallet later.
 *
 * `name` is load-bearing and `rdns` is not, which is the opposite of what
 * EIP-6963 intends. `connect`/`ensureConnected` accept a name (see
 * `WalletMechanism`), and some wallets announce an rdns that is scoped to the
 * browser session rather than stable across them, so an rdns recorded today can
 * fail to match the very same wallet tomorrow. Hence: `rdns` disambiguates two
 * announcements sharing a display name WITHIN a session, and a failure to match
 * it must never be read as the wallet being absent. See {@link findWallet}.
 */
export type WalletIdentity = {name: string; rdns?: string};

/**
 * An announced wallet, as much of one as this module reads.
 *
 * Structural, and NOT `WalletHandle` from the connection library, which does
 * not re-export it (only `@etherplay/wallet-connector` does, and that is a
 * transitive dependency this app has no other reason to name). The functions
 * below stay generic over it so a caller passing real handles gets real handles
 * back, and a test can pass two object literals.
 */
export type AnnouncedWallet = {info: {name: string; rdns?: string}};

/**
 * The connection state, as much of it as this module reads.
 *
 * Structural rather than `Connection<...>`, because this is called with BOTH
 * connections: the app's and the payment rail's. They have different store
 * types and the same two fields, and taking the union of the two would make the
 * narrower one impossible to pass. Also keeps the functions below pure and
 * testable from an object literal.
 */
export type WalletBearingState = {
	wallets?: readonly AnnouncedWallet[];
	mechanism?: {type?: string; name?: string};
};

/**
 * Which wallet a connection is holding right now, or undefined for one that is
 * holding none (dormant, mid-flow) or that authenticated without one (email or
 * social sign-in, where `mechanism.type` is not `'wallet'`).
 *
 * The name comes from `mechanism`, which is where the connection records the
 * wallet it agreed to, and the rdns is then looked up in the announcement list.
 * Undefined rdns is normal and harmless: it is only ever a tie-breaker.
 */
export function walletIdentityOf(
	$connection: WalletBearingState | undefined,
): WalletIdentity | undefined {
	const mechanism = $connection?.mechanism;
	if (!mechanism || mechanism.type !== 'wallet' || !mechanism.name) {
		return undefined;
	}
	const name = mechanism.name;
	const announced = $connection?.wallets?.find(
		(handle) => handle.info.name === name,
	);
	return announced?.info.rdns ? {name, rdns: announced.info.rdns} : {name};
}

/**
 * Find the announced wallet a recorded identity refers to.
 *
 * ORDER MATTERS, AND SO DOES THE FALLTHROUGH. `rdns` is tried first because it
 * tells two same-named announcements apart, but a miss means nothing: a
 * session-scoped rdns recorded in an earlier session cannot match anything
 * today, and treating that as "not installed" would tell users their wallet is
 * gone while it sits in their toolbar. So an rdns miss falls through to the
 * name, and ONLY a name miss is absence.
 */
export function findWallet<T extends AnnouncedWallet>(
	wallets: readonly T[] | undefined,
	identity: WalletIdentity | undefined,
): T | undefined {
	if (!identity || !wallets) return undefined;
	if (identity.rdns) {
		const byRdns = wallets.find((handle) => handle.info.rdns === identity.rdns);
		if (byRdns) return byRdns;
	}
	return wallets.find((handle) => handle.info.name === identity.name);
}

/**
 * The name to hand `ensureConnected`/`connect` for a recorded identity.
 *
 * Resolved against the live announcements rather than replayed from the record,
 * so a wallet that has since renamed itself is still reachable: the record's
 * name found the handle, the handle's name is what the library will match on
 * now. Falls back to the recorded name when nothing is announced, so a caller
 * can still attempt a connection and let it fail with the wallet's own error
 * rather than refusing pre-emptively.
 */
export function walletNameToReopen(
	wallets: readonly AnnouncedWallet[] | undefined,
	identity: WalletIdentity | undefined,
): string | undefined {
	if (!identity) return undefined;
	return findWallet(wallets, identity)?.info.name ?? identity.name;
}

/**
 * A transaction whose source predates this field, or was written by a build
 * that did not stamp one.
 *
 * The type says `source` is always there, and for anything sent from now on it
 * is. Stored operations are the exception: they were written by an older build,
 * they are read back through the same type, and a `undefined` arriving where the
 * type promises a value would otherwise reach the replacement path as a crash
 * rather than as the "I do not know which route sent this" it actually means.
 * One narrow check here, so no call site has to distrust its own types.
 */
export function isKnownSource(
	source: TxSource | undefined,
): source is TxSource {
	// Derived from TX_ROUTES rather than re-listing the routes, because a
	// descendant that adds one and updates only the union above gets a route this
	// rejects, and its own transactions silently become unreplaceable.
	return (
		!!source &&
		(TX_ROUTES as readonly string[]).includes(source.route as string)
	);
}
