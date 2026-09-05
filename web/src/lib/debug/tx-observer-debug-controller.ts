import {writable, type Readable} from 'svelte/store';
import type {Context} from '$lib/context/types';
import {
	toTransactionIntent,
	type ProjectableOperation,
} from '$lib/account/operation-intent';

export type DebugEvent = {timestamp: number; type: string; data: string};

export type TxObserverDebugController = {
	eventLog: Readable<DebugEvent[]>;
	operations: Readable<{[id: string]: unknown}>;
	sync: () => void;
	process: () => Promise<void>;
	checkTxStatus: (hash: `0x${string}`) => Promise<void>;
	refresh: () => void;
	/** Wire up the observer/accountData subscriptions + polling; returns teardown. */
	start: () => () => void;
};

/**
 * Controller for the TX-observer debug overlay: owns the event log, the cloned
 * operations snapshot, the manual sync/process/check actions, and the
 * subscription + polling lifecycle. Debug-only, kept out of the .svelte file so
 * the component is just badge colors + markup.
 *
 * Call `start()` from the component (e.g. in onMount) and invoke the returned
 * teardown on destroy.
 */
export function createTxObserverDebugController(
	context: Pick<Context, 'accountData' | 'publicClient' | 'txObserver'>,
): TxObserverDebugController {
	const {accountData, publicClient, txObserver} = context;

	const operations = writable<{[id: string]: unknown}>({});
	const eventLog = writable<DebugEvent[]>([]);

	function addEvent(type: string, data: unknown) {
		eventLog.update((log) => [
			{timestamp: Date.now(), type, data: JSON.stringify(data, null, 2)},
			...log.slice(0, 19), // Keep the last 20 events.
		]);
	}

	function refresh() {
		const currentAccountData = accountData.get()?.get();
		if (currentAccountData?.status === 'ready') {
			operations.set(structuredClone(currentAccountData.data.operations));
		}
	}

	function sync() {
		if (!txObserver) {
			addEvent('sync', {error: 'txObserver not available'});
			return;
		}
		const currentAccountData = accountData.get()?.get();
		if (currentAccountData?.status !== 'ready') {
			addEvent('sync', {error: 'accountData not ready'});
			return;
		}

		const ops = currentAccountData.data.operations;
		const intentsToAdd: {[id: string]: unknown} = {};
		for (const [id, operation] of Object.entries(ops)) {
			// The same projection the real connector feeds the observer, so this
			// debug path cannot hand it a different shape than production does.
			intentsToAdd[id] = structuredClone(
				toTransactionIntent(operation as ProjectableOperation),
			);
		}

		const count = Object.keys(intentsToAdd).length;
		addEvent('sync', {synced: count, ids: Object.keys(intentsToAdd)});
		if (count > 0) {
			txObserver.addMultiple(
				intentsToAdd as Parameters<typeof txObserver.addMultiple>[0],
			);
		}
	}

	async function process() {
		if (!txObserver) {
			addEvent('process', {error: 'txObserver not available'});
			return;
		}
		addEvent('process', {triggering: true});
		const result = txObserver.process();
		if (result && typeof result === 'object' && 'then' in result) {
			try {
				await result;
				addEvent('process', {completed: true});
			} catch (e) {
				addEvent('process', {error: String(e)});
			}
		}
	}

	async function checkTxStatus(hash: `0x${string}`) {
		addEvent('check', {hash: hash.slice(0, 12) + '...'});
		try {
			const receipt = await publicClient.getTransactionReceipt({hash});
			addEvent('check-result', {
				status: 'INCLUDED',
				block: receipt.blockNumber.toString(),
				txStatus: receipt.status,
			});
		} catch {
			try {
				const tx = await publicClient.getTransaction({hash});
				addEvent('check-result', {status: 'IN_MEMPOOL', nonce: tx.nonce});
			} catch {
				addEvent('check-result', {status: 'NOT_FOUND'});
			}
		}
	}

	function start() {
		const unsubscribeStatus = txObserver.on('intent:state', (event) => {
			addEvent('intent:state', {
				id: event.id,
				inclusion: event.intent.state?.inclusion,
				outcome: event.intent.state?.outcome,
				final: event.intent.state?.final,
			});
			refresh();
		});

		refresh();

		const unsubscribeAccountData = accountData.subscribe(() => refresh());
		const refreshInterval = setInterval(refresh, 2000);

		return () => {
			unsubscribeStatus();
			unsubscribeAccountData();
			clearInterval(refreshInterval);
		};
	}

	return {
		eventLog: {subscribe: eventLog.subscribe},
		operations: {subscribe: operations.subscribe},
		sync,
		process,
		checkTxStatus,
		refresh,
		start,
	};
}
