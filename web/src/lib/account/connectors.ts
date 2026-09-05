import type {Account, Chain, Transport} from 'viem';
import type {TrackedWalletClientType} from '@etherkit/viem-tx-tracker';
import type {MultiAccountDataStore, TransactionMetadata} from './AccountData';
import type {TxSource} from '$lib/core/connection/tx-source';
import type {TransactionObserver} from '@etherkit/tx-observer';
import {hookTxObserverToAccountData} from '$lib/core/utils/data/synqable-transactions';
import type {OnchainStateStore} from '$lib/onchain/state';
import {createConnector, combineTeardowns} from './connector';
import {toTransactionIntent} from './operation-intent';

/**
 * The transport/chain/account arguments are all spelled out at their defaults,
 * for the sole purpose of reaching TSource, which the tracker appended LAST.
 * Naming it is what makes `tx.source` typed on the events below, and therefore
 * what makes it reach storage; leaving it defaulted silently yields
 * `source: undefined` and the operations file no route at all.
 */
type TrackedClient = TrackedWalletClientType<
	TransactionMetadata,
	true,
	Transport,
	Chain | undefined,
	Account | undefined,
	TxSource
>;

/**
 * The only surface this connector needs from a tracked client: its event
 * subscription. Both the wallet-mode client and any signer-mode client satisfy
 * this regardless of their transport/chain generics (which `on` does not
 * mention), so no casting is needed to attach to either.
 *
 * NOT to be confused with {@link TxSource}, which is a transaction's signing
 * ROUTE. This is an emitter of tracked-transaction events, and it was called
 * `TrackedTxSource` until the two names in one file became a liability.
 */
type TrackedTxEmitter = Pick<TrackedClient, 'on'>;

/**
 * Told when a transaction was broadcast and could NOT be filed as an operation.
 *
 * A callback rather than a direct dependency on the in-flight ledger, so this
 * module keeps knowing only about account data, and so the failure can be
 * tested without one.
 */
export type UnrecordedBroadcast = (params: {
	from: `0x${string}`;
	nonce: number | undefined;
	hash: `0x${string}`;
	reason: unknown;
}) => void;

/**
 * Attach the broadcast/fetched listeners that feed tracked transactions into
 * Account Data. Returns a teardown.
 */
function attachTrackedClient(
	walletClient: TrackedTxEmitter,
	accountData: MultiAccountDataStore,
	onUnrecordedBroadcast?: UnrecordedBroadcast,
): () => void {
	return combineTeardowns([
		walletClient.on('transaction:broadcasted', (tx) => {
			// NOTHING MAY THROW OUT OF HERE.
			//
			// This runs inside the tracker's `emit`, which is fail-fast (no error
			// handler is registered), and `emit` is called by `writeContract` AFTER
			// the transaction has been broadcast but BEFORE it returns the hash. So a
			// throw here does not just skip the bookkeeping: it rejects the send, and
			// every caller reports a failure for a transaction that is already on
			// chain. Observed as a "Transaction error: accountData not ready" toast
			// over a greeting that had been posted successfully.
			//
			// Account data belongs to one account at a time, so it is genuinely
			// unavailable when the account went away between dispatch and answer (a
			// disconnect, an account switch). That is a real state, not a bug to
			// assert against, and the honest response is to hand the transaction to
			// something that CAN keep it: the in-flight ledger, which already holds a
			// record for this exact request and can now attach the hash to it.
			try {
				// A REPLACEMENT ATTACHES, ANYTHING ELSE CREATES.
				//
				// `correlation` is the tracker's per-call marker (0.2.0): the resubmit
				// names the operation it is replacing, the value rides along with the
				// send, and it arrives here verbatim. It is EPHEMERAL PLUMBING and is
				// deliberately not written into the record: it says which request this
				// send answers, not anything about the transaction. `hash` is the
				// durable identity, and everything below this line keys on that.
				//
				// UNDEFINED IS ORDINARY, not an error: every normal send has no
				// correlation, and so does a CANCEL, which must create its own
				// operation (see the comment in `cancelOperation` for why attaching
				// one would make the cancelled transaction report success and vanish).
				//
				// A correlation naming an operation that is no longer there also falls
				// through to creating one. That is reachable: account data deletes an
				// operation the moment it finalizes successfully, which can happen
				// between the send and the broadcast. Recording the transaction under
				// a new operation is imperfect; dropping it is worse, because the
				// transaction is on chain either way and the user should be able to
				// see it.
				const attached =
					tx.correlation !== undefined &&
					accountData.addTransactionToOperation(tx.correlation, tx);
				if (!attached) {
					accountData.addOperationFromTrackedTransaction(tx);
				}
			} catch (reason) {
				onUnrecordedBroadcast?.({
					from: tx.from,
					nonce: tx.nonce,
					hash: tx.hash,
					reason,
				});
			}
		}),
		// The same transaction once its values are FINAL rather than intended
		// (`transaction:known`, called `transaction:fetched` before tx-tracker
		// 0.2.0: the old name described the mechanism, which is not uniform, and a
		// raw send parses rather than fetches). It is NOT a mined signal: it fires
		// while the transaction is still in the mempool.
		//
		// Idempotent by construction, which matters as of 0.2.0: a raw send under
		// `populateMetadata` now emits this event too, where it previously emitted
		// only the broadcast. The handler finds its operation BY HASH and patches
		// that attempt in place, so receiving it twice writes the same values
		// twice. Nothing here appends, counts or notifies.
		walletClient.on('transaction:known', (tx) => {
			// Same reasoning, milder consequence: the tracker already wraps this emit
			// in a try/catch, so a throw here is swallowed and logged as "could not
			// fetch tx", which is a misleading thing to print about a fetch that
			// worked. There is nothing to salvage on this path (it only enriches an
			// operation that a successful broadcast already filed), so it is enough
			// not to lie about what failed.
			try {
				accountData.updateOperationFromKnownTransaction(tx);
			} catch (reason) {
				console.warn(
					`[account] could not update operation for ${tx.hash} from fetched ` +
						`transaction data. The operation keeps its broadcast-time values.`,
					reason,
				);
			}
		}),
	]);
}

/// Listen for broadcasted transactions and save them in the Account Data.
///
/// One client, always attached, for the app's lifetime. The executor sends from
/// the authenticated account through this same client, so its events always
/// belong to the current account's data and there is nothing to swap when the
/// account changes.
///
/// An app that also sends from a local signer has a SECOND client, and then this
/// grows a subscription: that client is derived per identity, so it has to be
/// detached and replaced when the identity changes, or a stale client's late
/// events get written into the wrong account's data. See the signer variant.
export function createTrackedWalletConnector(params: {
	walletClient: TrackedTxEmitter;
	accountData: MultiAccountDataStore;
	/**
	 * Where a broadcast goes when account data cannot take it. Optional so this
	 * connector stays usable on its own, but an app that sends transactions
	 * should supply it: without one, a transaction broadcast while no account is
	 * connected is simply gone.
	 */
	onUnrecordedBroadcast?: UnrecordedBroadcast;
}) {
	const {accountData, walletClient, onUnrecordedBroadcast} = params;

	return createConnector(() =>
		attachTrackedClient(walletClient, accountData, onUnrecordedBroadcast),
	);
}

/// Listen for Account Data transaction being added/removed
///  Notify the transaction observer
///  And in turn save any update from the observer
export function createTransactionObserverConnector(params: {
	txObserver: TransactionObserver;
	accountData: MultiAccountDataStore;
}) {
	const {accountData, txObserver} = params;

	return createConnector(() =>
		combineTeardowns([
			txObserver.on('intent:state', (event) =>
				accountData.updateOperationFromTransactionStateUpdated(event),
			),
			hookTxObserverToAccountData({
				accountData,
				mapKey: 'operations',
				// WHERE THE INTENT IS BUILT, and the only place it exists. The store
				// holds the call, the attempts and the observer's state; this joins
				// them into the shape the observer wants, on the way in.
				extractValue: toTransactionIntent,
				observer: txObserver,
			}),
		]),
	);
}

/// Listen for tx observer events and refresh onchain state when transactions are included
export function createOnchainStateRefreshConnector(params: {
	txObserver: TransactionObserver;
	onchainState: OnchainStateStore;
}) {
	const {txObserver, onchainState} = params;

	return createConnector(() =>
		txObserver.on('intent:state', (event) => {
			// Refresh onchain state when a transaction is included
			if (event.intent.state?.inclusion === 'Included') {
				onchainState.update();
			}
		}),
	);
}
