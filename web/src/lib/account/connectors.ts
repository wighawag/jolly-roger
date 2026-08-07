import type {TrackedWalletClientType} from '@etherkit/viem-tx-tracker';
import type {
	ExtendedTransactionMetadata,
	MultiAccountDataStore,
	TransactionMetadata,
} from './AccountData';
import type {TransactionObserver} from '@etherkit/tx-observer';
import {hookTxObserverToAccountData} from '$lib/core/utils/data/synqable-transactions';
import type {OnchainStateStore} from '$lib/onchain/state';
import type {ExecutorStore} from '$lib/core/connection/executor';
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
 * Account Data. Returns a teardown. Reused for both the wallet-mode client and
 * any signer-mode client the executor builds.
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
/// Attaches to the always-present wallet-mode client, and to every executor's
/// client, so a transaction is recorded whichever account signed it. That is
/// what puts the signer's silent work and the user's own prompted transactions
/// in ONE list: Account Data is keyed by the authenticated account, not by the
/// sender, so they belong to the same player and a consumer that wants them
/// apart filters on `from`.
///
/// Clients are attached by IDENTITY, and at most one per executor at a time:
/// - the wallet client is attached once and never swapped (in account execution
///   the sender is always the current account);
/// - an executor whose client IS the wallet client adds nothing;
/// - two executors sharing one client (both pointed at the same signer) attach
///   it once;
/// - when an executor exposes a DIFFERENT client (re-sign-in as another
///   identity derives another key), the previous one is detached first. That is
///   correctness, not hygiene: `accountData` follows the CURRENT account, so a
///   stale client's late events would be written into the wrong account's data.
export function createTrackedWalletConnector(params: {
	walletClient: TrackedTxSource;
	executors: readonly ExecutorStore[];
	accountData: MultiAccountDataStore;
}) {
	const {accountData, walletClient, executors} = params;

	return createConnector(() => {
		const walletTeardown = attachTrackedClient(walletClient, accountData);

		// Per-executor, so one executor swapping its client never detaches
		// another's. Keyed by position rather than by the executor object, which
		// keeps this independent of how many there are.
		const attached: (TrackedTxSource | undefined)[] = executors.map(
			() => undefined,
		);
		const teardowns: ((() => void) | undefined)[] = executors.map(
			() => undefined,
		);

		/** Whether some OTHER slot already listens to this exact client. */
		const attachedElsewhere = (client: TrackedTxSource, self: number) =>
			attached.some((c, i) => i !== self && c === client);

		const unsubscribes = executors.map((executor, i) =>
			executor.subscribe(($executor) => {
				// Transient not-ready states (reconnection steps) keep the current
				// attachment: detaching would drop follow-up events (e.g.
				// transaction:fetched) for a same-account reconnect. Only an actual
				// REPLACEMENT client triggers a swap.
				if ($executor.status !== 'ready') return;
				const client = $executor.client;
				if (client === walletClient || client === attached[i]) return;
				teardowns[i]?.();
				attached[i] = client;
				teardowns[i] = attachedElsewhere(client, i)
					? undefined
					: attachTrackedClient(client, accountData);
			}),
		);

		return () => {
			for (const u of unsubscribes) u();
			for (const t of teardowns) t?.();
			walletTeardown();
		};
	});
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
