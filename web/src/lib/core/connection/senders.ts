import {get} from 'svelte/store';
import type {BalanceStore} from './balance';
import type {ExecutorStore} from './executor';
import {isKnownSource, type TxSource, type WalletIdentity} from './tx-source';

/**
 * One route this app can send from, with what it takes to send from it AGAIN
 * later.
 *
 * THE SET IS OPEN AND THE APP COMPOSES IT. This branch registers one sender;
 * `with/local-signer` must register three (the account, the local signer, and
 * the wallet on the payment rail). Today it registers two, from a hardcoded pair
 * inside its own copy of the replacement code, and that is exactly how the
 * payment rail came to be a route that could send transactions but could never
 * replace one: nothing failed, nothing warned, the button simply reported the
 * user's own payment as belonging to a stranger. A registry does not prevent
 * forgetting to register, but it puts the omission in one visible place instead
 * of inside an unrelated module.
 *
 * SEE ALSO `PayerKind` in core/transaction/insufficient-funds-view, which is
 * this same set of accounts asked "which one is short, and what would fix it".
 * A route belongs in both, or the app can send transactions it can neither
 * replace nor fund.
 *
 * `balance` travels WITH the executor deliberately. A replacement is priced
 * against the account actually sending it, and picking the executor from one
 * place and the balance from another is how a top-up once funded an address that
 * was not the one that was short.
 */
export type Sender = {
	/** Which {@link TxSource} route this sender is. Unique within the registry. */
	route: TxSource['route'];
	executor: ExecutorStore;
	balance: BalanceStore;
	/**
	 * Make this route able to sign as `address`, raising the connection flow if
	 * it is not already.
	 *
	 * Called at the top of every replacement, not only when something looks
	 * wrong, because it is a no-op when the route is already there. That is the
	 * same shape as every other send in this app: `setGreeting` and
	 * `contractCall` open with `ensureConnected()` and let it decide whether
	 * anything needs to happen. It replaced a two-step "you are disconnected,
	 * press here to reconnect, now press resubmit again", which asked the user to
	 * perform a step the action could take itself.
	 *
	 * Throws the way `ensureConnected` throws, so the caller maps a refusal to a
	 * cancellation exactly as the other sends do.
	 *
	 * COMPOSED PER SENDER, not derived from the route, because what "able to
	 * sign" means differs and not every app can reach every step:
	 *
	 * - A wallet route wants `ensureCanSignAs`, which names the recorded wallet
	 *   AND the address, and must say whether reconnecting should be remembered.
	 * - The local signer has no wallet to name and no address to pick inside one.
	 *   Its whole implementation is `() => connection.ensureConnected()`, which
	 *   drives to the connection's target step, i.e. signs in. Reaching for
	 *   `ensureCanSignAs` there would ask a wallet for an address it has never
	 *   heard of.
	 *
	 * That is also why the step is not decided here: an app configured to stop at
	 * `WalletConnected` has no `SignedIn` to ask for, and its `ensureConnected`
	 * has no overload accepting one.
	 *
	 * Optional so a route with genuinely nothing to connect can omit it.
	 */
	ensureCanSign?: (target: {
		address: `0x${string}`;
		wallet?: WalletIdentity;
	}) => Promise<void>;
};

export type SenderRegistry = readonly Sender[];

/**
 * Which sender to replace a given transaction through.
 *
 * ROUTE FIRST, and that is the point. The route is recorded at dispatch and says
 * which key signed, whether or not that key is reachable this second. Searching
 * instead for the address among currently-ready executors can only ever find
 * routes that happen to be awake, which is why a dormant payment rail used to be
 * reported to the user as somebody else's account.
 *
 * On the recorded-route path, readiness is deliberately NOT considered: the
 * caller ensures the route can sign and then reads the executor, so a route that
 * is merely asleep is not a different answer from one that is awake; it is the
 * same answer with a connection flow in front of it. The no-source fallback
 * below is the exception and says why.
 *
 * Reads each executor's current value on that fallback path only; otherwise it
 * is a decision taken from the registry and the transaction alone.
 */
export type SenderSelection =
	| {status: 'found'; sender: Sender}
	/** No route here can produce this signature. Say so and stop. */
	| {status: 'unavailable'; address: `0x${string}`};

export function selectSender(
	senders: SenderRegistry,
	tx: {from: `0x${string}`; source?: TxSource},
): SenderSelection {
	if (isKnownSource(tx.source)) {
		const route = tx.source.route;
		const sender = senders.find((candidate) => candidate.route === route);
		// A recorded route this build no longer registers: stored data outliving a
		// change. Unavailable is right, because there is genuinely nothing here
		// that can sign it.
		return sender
			? {status: 'found', sender}
			: {status: 'unavailable', address: tx.from};
	}

	// NO RECORDED ROUTE: an operation stored before sources existed.
	//
	// With exactly one sender there is nothing to choose, so it is used, and a
	// locked wallet is still recoverable. With several, guessing which wallet to
	// open would be guessing at the user's expense, so fall back to the old
	// behaviour of matching an already-ready executor by address and reporting
	// nothing when none does.
	if (senders.length === 1) return {status: 'found', sender: senders[0]};

	const from = tx.from.toLowerCase();
	for (const sender of senders) {
		const state = get(sender.executor);
		if (state.status === 'ready' && state.address.toLowerCase() === from) {
			return {status: 'found', sender};
		}
	}
	return {status: 'unavailable', address: tx.from};
}

/** The wallet recorded at dispatch, for the routes that have one. */
export function walletOf(
	source: TxSource | undefined,
): WalletIdentity | undefined {
	if (!isKnownSource(source)) return undefined;
	return source.route === 'signer' ? undefined : source.wallet;
}
