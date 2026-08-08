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
 * Attach the broadcast/fetched listeners that feed tracked transactions into
 * Account Data. Returns a teardown.
 */
function attachTrackedClient(
	walletClient: TrackedTxSource,
	accountData: MultiAccountDataStore,
): () => void {
	return combineTeardowns([
		walletClient.on('transaction:broadcasted', (tx) => {
			// Check if this is a resubmit (has operationId in metadata)
			const metadata = tx.metadata as ExtendedTransactionMetadata;
			if (metadata.operationId) {
				// Add transaction to existing operation
				accountData.addTransactionToOperation(metadata.operationId, tx);
			} else {
				// Create new operation
				accountData.addOperationFromTrackedTransaction(tx);
			}
		}),
		// if needed we can also update on getting the full tx data
		walletClient.on('transaction:fetched', (tx) => {
			accountData.updateOperationFromFetchedTransaction(tx);
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
}) {
	const {accountData, walletClient} = params;

	return createConnector(() => attachTrackedClient(walletClient, accountData));
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
