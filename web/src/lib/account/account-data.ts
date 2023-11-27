import type {EIP1193TransactionWithMetadata} from 'web3-connection';
import type {PendingTransaction, PendingTransactionState} from 'ethereum-tx-observer';
import {initEmitter} from 'radiate';
import {writable} from 'svelte/store';
import {AccountDB, type AccountInfo, type SyncInfo, type SyncingState} from './account-db';
import {createClient, mainnetClient} from '$lib/fuzd';
import {FUZD_URI} from '$lib/config';

export type SendMessageMetadata = {
	type: 'message';
	message: string;
};
export type AnyMetadata = SendMessageMetadata;

export type JollyRogerTransaction<T = AnyMetadata> = EIP1193TransactionWithMetadata & {
	metadata?: T;
};

export type OnChainAction<T = AnyMetadata> = {
	tx: JollyRogerTransaction<T>;
} & PendingTransactionState;
export type OnChainActions = {[hash: `0x${string}`]: OnChainAction};

export type AccountData = {
	onchainActions: OnChainActions;
};

const emptyAccountData: AccountData = {onchainActions: {}};

function fromOnChainActionToPendingTransaction(hash: `0x${string}`, onchainAction: OnChainAction): PendingTransaction {
	return {
		hash,
		request: onchainAction.tx,
		final: onchainAction.final,
		inclusion: onchainAction.inclusion,
		status: onchainAction.status,
	} as PendingTransaction;
}

export function initAccountData(dbName: string, syncInfo?: SyncInfo) {
	const emitter = initEmitter<{name: 'newTx'; txs: PendingTransaction[]} | {name: 'clear'}>();

	const $onchainActions: OnChainActions = {};
	const onchainActions = writable<OnChainActions>($onchainActions);

	let fuzdClient: ReturnType<typeof createClient> | undefined;

	let accountDB: AccountDB<AccountData> | undefined;
	let unsubscribeFromSync: (() => void) | undefined;

	async function load(info: AccountInfo, remoteSyncEnabled?: boolean) {
		const data = await _load(info, remoteSyncEnabled);

		for (const hash in data.onchainActions) {
			const onchainAction = (data.onchainActions as any)[hash];
			($onchainActions as any)[hash] = onchainAction;
		}
		onchainActions.set($onchainActions);
		handleTxs($onchainActions);
	}

	function handleTxs(onChainActions: OnChainActions) {
		const pending_transactions: PendingTransaction[] = [];
		for (const hash in onChainActions) {
			const onchainAction = (onChainActions as any)[hash];
			const tx = fromOnChainActionToPendingTransaction(hash as `0x${string}`, onchainAction);
			pending_transactions.push(tx);
		}
		emitter.emit({name: 'newTx', txs: pending_transactions});
	}

	async function unload() {
		//save before unload
		await save();

		if (unsubscribeFromSync) {
			unsubscribeFromSync();
			unsubscribeFromSync = undefined;
		}

		accountDB?.destroy();
		accountDB = undefined;

		fuzdClient = undefined;

		// delete all
		for (const hash of Object.keys($onchainActions)) {
			delete ($onchainActions as any)[hash];
		}
		onchainActions.set($onchainActions);

		emitter.emit({name: 'clear'});
	}

	async function save() {
		_save({
			onchainActions: $onchainActions,
		});
	}

	function _merge(
		localData?: AccountData,
		remoteData?: AccountData,
	): {newData: AccountData; newDataOnLocal: boolean; newDataOnRemote: boolean} {
		let newDataOnLocal = false;
		let newDataOnRemote = false;

		let newData: AccountData;
		if (!localData) {
			newData = {
				onchainActions: {},
			};
		} else {
			newData = localData;
		}

		// hmm check if valid
		if (!remoteData || !remoteData.onchainActions) {
			remoteData = {
				onchainActions: {},
			};
		}

		for (const key of Object.keys(remoteData.onchainActions)) {
			const txHash = key as `0x${string}`;
			if (!newData.onchainActions[txHash]) {
				newData.onchainActions[txHash] = remoteData.onchainActions[txHash];
				newDataOnRemote = true;
			}
		}

		for (const key of Object.keys(newData.onchainActions)) {
			const txHash = key as `0x${string}`;
			if (!remoteData.onchainActions[txHash]) {
				newDataOnLocal = true;
				break;
			}
		}

		return {
			newData,
			newDataOnLocal,
			newDataOnRemote,
		};
	}

	async function _load(info: AccountInfo, remoteSyncEnabled?: boolean): Promise<AccountData> {
		accountDB = new AccountDB(
			dbName,
			info,
			_merge,
			syncInfo
				? {...syncInfo, enabled: remoteSyncEnabled === undefined ? syncInfo.enabled : remoteSyncEnabled}
				: undefined,
		);
		if (FUZD_URI) {
			if (!info.localKey) {
				throw new Error(`no local key, FUZD requires it`);
			}
			fuzdClient = createClient({
				drand: mainnetClient(),
				privateKey: info.localKey,
				schedulerEndPoint: FUZD_URI,
			});
		}

		unsubscribeFromSync = accountDB.subscribe(onSync);
		return (await accountDB.requestSync(true)) || emptyAccountData;
	}

	function onSync(syncingState: SyncingState<AccountData>): void {
		// TODO ?
		// $onchainActions = syncingState.data?.onchainActions || {};
		// onchainActions.set($onchainActions);
		// $offchainState = syncingState.data?.offchainState;
		// offchainState.set($offchainState);
	}

	async function _save(accountData: AccountData) {
		if (accountDB) {
			accountDB.save(accountData);
		}
	}

	function addAction(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`, inclusion?: 'Broadcasted') {
		if (!tx.metadata) {
			console.error(`no metadata on the tx, we still save it, but this will not let us know what this tx is about`);
		} else if (typeof tx.metadata !== 'object') {
			console.error(`metadata is not an object and so do not conform to Expected Metadata`);
		} else {
			if (!('type' in tx.metadata)) {
				console.error(`no field "type" in the metadata and so do not conform to Expected Metadata`);
			}
		}

		const onchainAction: OnChainAction = {
			tx: tx as JollyRogerTransaction,
			inclusion: inclusion || 'BeingFetched',
			final: undefined,
			status: undefined,
		};

		$onchainActions[hash] = onchainAction;
		save();
		onchainActions.set($onchainActions);

		emitter.emit({
			name: 'newTx',
			txs: [fromOnChainActionToPendingTransaction(hash, onchainAction)],
		});
	}

	function _updateTx(pendingTransaction: PendingTransaction): boolean {
		const action = $onchainActions[pendingTransaction.hash];
		if (action) {
			if (
				action.inclusion !== pendingTransaction.inclusion ||
				action.status !== pendingTransaction.status ||
				action.final !== pendingTransaction.final
			) {
				action.inclusion = pendingTransaction.inclusion;
				action.status = pendingTransaction.status;
				action.final = pendingTransaction.final;
				return true;
			}
		}
		return false;
	}

	function updateTx(pendingTransaction: PendingTransaction) {
		if (_updateTx(pendingTransaction)) {
			onchainActions.set($onchainActions);
			save();
		}
	}

	function updateTxs(pendingTransactions: PendingTransaction[]) {
		let anyChanges = false;
		for (const p of pendingTransactions) {
			anyChanges = anyChanges || _updateTx(p);
		}
		if (anyChanges) {
			onchainActions.set($onchainActions);
			save();
		}
	}

	// use with caution
	async function _reset() {
		await unload();
		accountDB?.clearData();
	}

	async function getFuzd() {
		if (!fuzdClient) {
			throw new Error(`no fuzd client setup`);
		}
		const remoteAccount = await fuzdClient.getRemoteAccount();
		return {
			remoteAccount,
			scheduleExecution(
				execution: {
					slot: string;
					chainId: string;
					gas: bigint;
					broadcastSchedule: [{duration: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint}];
					data: `0x${string}`;
					to: `0x${string}`;
					time: number;
				},
				options?: {fakeEncrypt?: boolean},
			) {
				if (!fuzdClient) {
					throw new Error(`no fuzd client setup`);
				}
				return fuzdClient.scheduleExecution(execution, options);
			},
		};
	}

	return {
		$onchainActions,
		onchainActions: {
			subscribe: onchainActions.subscribe,
		},

		load,
		unload,
		updateTx,
		updateTxs,

		getFuzd,

		onTxSent(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`) {
			addAction(tx, hash, 'Broadcasted');
			save();
		},

		on: emitter.on,
		off: emitter.off,

		_reset,
	};
}
