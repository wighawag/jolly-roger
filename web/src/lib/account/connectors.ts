import type {TrackedWalletClientType} from '@etherkit/viem-tx-tracker';
import type {
	ExtendedTransactionMetadata,
	MultiAccountDataStore,
	TransactionMetadata,
} from './AccountData';
import type {TransactionObserver} from '@etherkit/tx-observer';
import {hookTxObserverToAccountData} from '$lib/core/utils/data/synqable-transactions';
import type {OnchainStateStore} from '$lib/onchain/state';
import {createConnector, combineTeardowns} from './connector';

type TrackedClient = TrackedWalletClientType<TransactionMetadata, true>;

/**
 * The only surface this connector needs from a tracked client: its event
 * subscription. Both the wallet-mode client and any signer-mode client satisfy
 * this regardless of their transport/chain generics (which `on` does not
 * mention), so no casting is needed to attach to either.
 */
type TrackedTxSource = Pick<TrackedClient, 'on'>;

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
	walletClient: TrackedTxSource,
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
				// Check if this is a resubmit (has operationId in metadata)
				const metadata = tx.metadata as ExtendedTransactionMetadata;
				if (metadata.operationId) {
					// Add transaction to existing operation
					accountData.addTransactionToOperation(metadata.operationId, tx);
				} else {
					// Create new operation
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
		// if needed we can also update on getting the full tx data
		walletClient.on('transaction:fetched', (tx) => {
			// Same reasoning, milder consequence: the tracker already wraps this emit
			// in a try/catch, so a throw here is swallowed and logged as "could not
			// fetch tx", which is a misleading thing to print about a fetch that
			// worked. There is nothing to salvage on this path (it only enriches an
			// operation that a successful broadcast already filed), so it is enough
			// not to lie about what failed.
			try {
				accountData.updateOperationFromFetchedTransaction(tx);
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
	walletClient: TrackedTxSource;
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
			txObserver.on('intent:status', (event) =>
				accountData.updateOperationFromTransactionStateUpdated(event),
			),
			hookTxObserverToAccountData({
				accountData,
				mapKey: 'operations',
				extractValue: (item) => item.transactionIntent,
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
		txObserver.on('intent:status', (event) => {
			// Refresh onchain state when a transaction is included
			if (event.intent.state?.inclusion === 'Included') {
				onchainState.update();
			}
		}),
	);
}
