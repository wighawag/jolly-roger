import type {TrackedWalletClientType} from '@etherkit/viem-tx-tracker';
import type {
	ExtendedTransactionMetadata,
	MultiAccountDataStore,
	TransactionMetadata,
} from './AccountData';
import type {TransactionObserver} from '@etherkit/tx-observer';
import {hookTxObserverToAccountData} from '$lib/core/utils/data/synqable-transactions';
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
 * Account Data. Returns a teardown. Reused for both the wallet-mode client and
 * any signer-mode client the executor builds.
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
	/**
	 * Where a broadcast goes when account data cannot take it. Optional so this
	 * connector stays usable on its own, but an app that sends transactions
	 * should supply it: without one, a transaction broadcast while no account is
	 * connected is simply gone.
	 */
	onUnrecordedBroadcast?: UnrecordedBroadcast;
}) {
	const {accountData, walletClient, executors, onUnrecordedBroadcast} = params;

	return createConnector(() => {
		// The fallback goes to EVERY client, not just the wallet one. A signer
		// broadcast that cannot be filed is lost exactly the same way, and the
		// ledger already holds a record for it that the hash can be attached to.
		const walletTeardown = attachTrackedClient(
			walletClient,
			accountData,
			onUnrecordedBroadcast,
		);

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
					: attachTrackedClient(client, accountData, onUnrecordedBroadcast);
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

/**
 * The refreshable chain reads: anything a transaction of ours can invalidate.
 *
 * A LIST rather than the one store this started with, because there is now more
 * than one read the app gates behaviour on. The delegation read in particular is
 * changed BY a transaction the app sends, so leaving it to its own poll means
 * the UI goes on refusing a send for something that already landed.
 */
type RefreshableStore = {update: () => Promise<unknown>};

/// Listen for tx observer events and refresh chain reads when transactions are included
export function createOnchainStateRefreshConnector(params: {
	txObserver: TransactionObserver;
	stores: readonly RefreshableStore[];
}) {
	const {txObserver, stores} = params;

	return createConnector(() =>
		txObserver.on('intent:status', (event) => {
			// Refresh when a transaction is included
			if (event.intent.state?.inclusion === 'Included') {
				for (const store of stores) void store.update();
			}
		}),
	);
}
