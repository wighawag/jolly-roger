import {writable} from 'svelte/store';

import type {EIP1193TransactionWithMetadata} from 'web3-connection';
import {initEmitter} from 'radiate';
import type {PendingTransaction} from 'ethereum-tx-observer';

export type AccountFunctions<AccountData, Action> = {
	fromAccountDataToActions: (data: AccountData) => {action: Action; hash: `0x${string}`}[];
	fromActionToPendingTransactions: (hash: `0x${string}`, action: Action) => PendingTransaction;
	updateActionFromPendingTransactionUpdate: (data: AccountData, pendingTransaction: PendingTransaction) => Action;
	addActionFromTransaction: (
		data: AccountData,
		tx: EIP1193TransactionWithMetadata,
		hash: `0x${string}`,
		inclusion?: 'Broadcasted'
	) => Action;
};

export function initAccount<AccountData, Action>({
	fromAccountDataToActions,
	fromActionToPendingTransactions,
	updateActionFromPendingTransactionUpdate,
	addActionFromTransaction,
}: AccountFunctions<AccountData, Action>) {
	const emitter = initEmitter<{name: 'newTx'; txs: PendingTransaction[]} | {name: 'clear'}>();

	let $data: AccountData | undefined;
	const data = writable<AccountData | undefined>($data);

	let key: string | undefined;
	async function load(address: `0x${string}`, chainId: string, genesisHash?: string) {
		const newData = await _load(address, chainId, genesisHash);
		const actionsData = fromAccountDataToActions(newData);
		const pending_transactions: PendingTransaction[] = [];
		for (const actionData of actionsData) {
			const pending_transaction: PendingTransaction = fromActionToPendingTransactions(
				actionData.hash,
				actionData.action
			);
			pending_transactions.push(pending_transaction);
		}
		emitter.emit({name: 'newTx', txs: pending_transactions});
		$data = newData;
		data.set($data);
	}

	async function unload() {
		//save before unload
		await save();

		// delete all
		$data = undefined;
		data.set($data);
		emitter.emit({name: 'clear'});
	}

	async function save() {
		if ($data) {
			_save($data);
		}
	}

	async function _load(address: `0x${string}`, chainId: string, genesisHash?: string): Promise<AccountData> {
		key = `account_${address}_${chainId}_${genesisHash}`;
		let dataSTR: string | undefined | null;
		try {
			dataSTR = localStorage.getItem(key);
		} catch {}
		return dataSTR ? JSON.parse(dataSTR) : {actions: {}};
	}

	async function _save(data: AccountData) {
		if (key) {
			localStorage.setItem(key, JSON.stringify(data));
		}
	}

	function addAction(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`, inclusion?: 'Broadcasted') {
		if (!$data) {
			throw new Error(`adding action on non-existent state`);
		}
		const action: Action = addActionFromTransaction($data, tx, hash, inclusion);
		save();
		data.set($data);

		emitter.emit({
			name: 'newTx',
			txs: [fromActionToPendingTransactions(hash, action)],
		});
	}

	function updateTx(pendingTransaction: PendingTransaction) {
		if (!$data) {
			throw new Error(`adding action on non-existent state`);
		}
		updateActionFromPendingTransactionUpdate($data, pendingTransaction);
		save();
		data.set($data);
	}

	function updateTxs(pendingTransactions: PendingTransaction[]) {
		if (!$data) {
			throw new Error(`adding action on non-existent state`);
		}
		for (const p of pendingTransactions) {
			updateActionFromPendingTransactionUpdate($data, p);
		}
		save();
		data.set($data);
	}

	// use with caution
	async function _reset() {
		await unload();
		if (key) {
			localStorage.removeItem(key);
		}
	}

	return {
		data: {
			subscribe: data.subscribe,
		},

		load,
		unload,
		updateTx,
		updateTxs,

		onTxSent(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`) {
			addAction(tx, hash, 'Broadcasted');
			save();
			data.set($data);
		},

		on: emitter.on,
		off: emitter.off,

		_reset,
	};
}
