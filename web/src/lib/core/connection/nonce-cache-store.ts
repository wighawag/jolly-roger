import {writable, type Readable} from 'svelte/store';
import type {
	TransactionObserver,
	BroadcastedTransaction,
	TransactionIntent,
} from '@etherkit/tx-observer';
import type {AccountStore, ChainConnection} from './types';
import {
	detectNonceCache,
	isStrandedNonce,
	nodeNonceReader,
	type NonceCacheProvider,
	type NonceCacheStatus,
} from './nonce-cache';

/**
 * Reactive detector for a wallet with a STALE CACHED NONCE on the current chain
 * (see nonce-cache.ts). It drives a warning banner.
 *
 * Primary signal is GROUND TRUTH: it watches the transaction observer and, for
 * any transaction that is still pending with a nonce ABOVE the node's next
 * expected nonce, reports `'cache'`. This is what actually strands the tx and
 * is the only signal that catches wallets like Rabby (which proxy
 * `eth_getTransactionCount` to the node, so the pre-send poll below reads
 * healthy even while they broadcast a stale nonce).
 *
 * Secondary signal is a PRE-SEND POLL on connect/account-change: compares the
 * wallet provider's pending nonce against the node's. It catches wallets that
 * report their locally-tracked nonce (older MetaMask) before any tx is sent,
 * but silently reads healthy for Rabby. Kept as an early best-effort hint.
 *
 * GATING lives in the factory: only meaningful when the app has its OWN trusted
 * node RPC (`nodeRpcUrl`) to compare against, and only worth the cost in dev.
 * The caller builds the real store then, or {@link inactiveNonceCacheStore}
 * otherwise, so subscribers always see a stable "healthy" value at zero cost.
 */

export type NonceCacheValue = {
	/** Latest classification, or `undefined` while unknown / not yet checked. */
	status: NonceCacheStatus;
	/** The stale/broadcast nonce at the last positive detection (for the message). */
	walletNonce?: number;
	/** Node's next expected (pending) nonce at the last detection (for the message). */
	nodeNonce?: number;
};

export type NonceCacheStore = Readable<NonceCacheValue> & {
	/** Re-run the checks now (e.g. after a tx is observed stuck pending). */
	recheck: () => void;
};

/**
 * A permanently-inactive store: always `{status: false}`, no work, no subscriptions.
 * Used when detection is not applicable (no app node RPC, or production build).
 */
export const inactiveNonceCacheStore: NonceCacheStore = {
	subscribe: writable<NonceCacheValue>({status: false}).subscribe,
	recheck: () => {},
};

/** A pending (still-in-flight) broadcast tx has no final inclusion yet. */
function isPending(tx: BroadcastedTransaction): boolean {
	const inclusion = tx.state?.inclusion;
	// No state yet, or explicitly in mempool / not-found => still pending. Only
	// 'Included' or 'Dropped' are terminal (and thus not "stranded").
	return inclusion === undefined || inclusion === 'InMemPool' || inclusion === 'NotFound';
}

export function createNonceCacheStore(params: {
	connection: ChainConnection;
	account: AccountStore;
	txObserver: TransactionObserver;
	/** The app's trusted node RPC url to compare the wallet against. */
	nodeRpcUrl: string;
}): NonceCacheStore {
	const {connection, account, txObserver, nodeRpcUrl} = params;

	const store = writable<NonceCacheValue>({status: undefined});

	let currentAccount: `0x${string}` | undefined;

	// Local mirror of the observer's intents, kept in sync from its events (the
	// observer exposes no getter). Keyed by intent id.
	const intents = new Map<string, TransactionIntent>();

	function setStatus(value: NonceCacheValue) {
		store.set(value);
	}

	// --- Primary: ground-truth from broadcast transactions --------------------

	// Guard so a heal (no stranded tx now) does not clobber a still-valid warning
	// mid-flight; each scan is authoritative for the txs it saw.
	let scanToken = 0;

	async function scanObservedTransactions() {
		const token = ++scanToken;
		const address = currentAccount;
		if (!address) return;

		// Collect this account's pending, nonce-bearing broadcast txs across all
		// intents. `getIntents` is a snapshot; the observer emits when it changes.
		const pendingTxs: BroadcastedTransaction[] = [];
		for (const intent of intents.values()) {
			for (const tx of intent.transactions) {
				if (tx.from?.toLowerCase() !== address.toLowerCase()) continue;
				if (tx.nonce === undefined) continue;
				if (!isPending(tx)) continue;
				pendingTxs.push(tx);
			}
		}
		if (pendingTxs.length === 0) {
			// Nothing pending to be stranded. Do not force-heal a poll-based warning;
			// only clear if we currently hold a ground-truth 'cache'.
			return;
		}

		const nodePending = await nodeNonceReader(nodeRpcUrl, address)();
		if (token !== scanToken) return; // superseded
		if (nodePending === undefined) return; // cannot decide, stay silent

		let worst: number | undefined;
		for (const tx of pendingTxs) {
			if (isStrandedNonce({txNonce: tx.nonce, nodePending, pending: true})) {
				worst = worst === undefined ? tx.nonce! : Math.max(worst, tx.nonce!);
			}
		}

		if (worst !== undefined) {
			setStatus({status: 'cache', walletNonce: worst, nodeNonce: nodePending});
		}
	}

	// --- Secondary: pre-send poll on connect / account change -----------------

	let pollToken = 0;

	async function pollWalletVsNode(address: `0x${string}` | undefined) {
		const token = ++pollToken;
		if (!address) {
			setStatus({status: false});
			return;
		}

		const provider = connection.provider as unknown as
			| NonceCacheProvider
			| undefined;
		if (!provider || typeof provider.request !== 'function') {
			setStatus({status: undefined});
			return;
		}

		const readNode = nodeNonceReader(nodeRpcUrl, address);
		let nodeNonce: number | undefined;
		let status: NonceCacheStatus;
		try {
			status = await detectNonceCache({
				provider,
				address,
				readNode: async () => {
					nodeNonce = await readNode();
					return nodeNonce;
				},
			});
		} catch {
			status = undefined;
		}
		if (token !== pollToken) return;

		// Only let the poll SET a warning or a fresh healthy read; never let it
		// clear a ground-truth 'cache' already raised from a broadcast tx.
		if (status === 'cache') {
			let walletNonce: number | undefined;
			try {
				const raw = await provider.request({
					method: 'eth_getTransactionCount',
					params: [address, 'pending'],
				});
				walletNonce = typeof raw === 'string' ? Number(raw) : (raw as number);
				if (!Number.isFinite(walletNonce)) walletNonce = undefined;
			} catch {
				walletNonce = undefined;
			}
			if (token !== pollToken) return;
			setStatus({status: 'cache', walletNonce, nodeNonce});
			return;
		}

		let held: NonceCacheValue = {status: undefined};
		const u = store.subscribe((v) => (held = v));
		u();
		if (held.status === 'cache') return; // keep ground-truth warning
		setStatus({status});
	}

	// --- Lifecycle ------------------------------------------------------------

	let unsubscribeAccount: (() => void) | undefined;
	let offObserver: (() => void)[] = [];

	function start() {
		unsubscribeAccount = account.subscribe((address) => {
			currentAccount = address;
			// New/changed account (incl. reconnect after a wallet reset, which heals
			// it): re-run both signals from a clean slate.
			void pollWalletVsNode(address);
			void scanObservedTransactions();
		});

		const onIntentEvent = (data: {id: string; intent: TransactionIntent}) => {
			intents.set(data.id, data.intent);
			void scanObservedTransactions();
		};
		const onIntentsAdded = (data: Record<string, TransactionIntent>) => {
			for (const [id, intent] of Object.entries(data)) intents.set(id, intent);
			void scanObservedTransactions();
		};
		const onIntentsRemoved = (ids: string[]) => {
			for (const id of ids) intents.delete(id);
		};
		const onIntentsCleared = () => {
			intents.clear();
		};
		offObserver = [
			txObserver.on('intent:updated', onIntentEvent),
			txObserver.on('intent:status', onIntentEvent),
			txObserver.on('intents:added', onIntentsAdded),
			txObserver.on('intents:removed', onIntentsRemoved),
			txObserver.on('intents:cleared', onIntentsCleared),
		];

		return stop;
	}

	function stop() {
		scanToken++;
		pollToken++;
		unsubscribeAccount?.();
		unsubscribeAccount = undefined;
		for (const off of offObserver) off();
		offObserver = [];
		intents.clear();
	}

	let refCount = 0;
	let stopLifecycle: (() => void) | undefined;

	return {
		subscribe(run, invalidate) {
			if (refCount === 0) stopLifecycle = start();
			refCount++;
			const unsub = store.subscribe(run, invalidate);
			return () => {
				unsub();
				refCount--;
				if (refCount === 0) {
					stopLifecycle?.();
					stopLifecycle = undefined;
				}
			};
		},
		recheck: () => {
			void pollWalletVsNode(currentAccount);
			void scanObservedTransactions();
		},
	};
}
