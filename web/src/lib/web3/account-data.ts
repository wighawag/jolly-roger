import { writable } from 'svelte/store';

import type { EIP1193TransactionWithMetadata } from 'web3-connection/dist/provider/wrap';
import { initEmitter } from '$external/callbacks';
import type { PendingTransaction } from '$external/tx-observer';

export type Action = {
	tx: EIP1193TransactionWithMetadata;
} & (
	| {
			inclusion: 'Loading' | 'Pending' | 'NotFound' | 'Cancelled';
			final: undefined;
			status: undefined;
	  }
	| {
			inclusion: 'Included';
			status: 'Failure' | 'Success';
			final: number;
	  }
);

export type Actions = { [hash: `0x${string}`]: Action };

function fromActionToPendingTransaction(hash: `0x${string}`, action: Action): PendingTransaction {
	return {
		hash,
		request: action.tx,
		final: action.final,
		inclusion: action.inclusion,
		status: action.status,
	} as PendingTransaction;
}

export function initAccountData() {
	const emitter = initEmitter<{ name: 'newTx'; txs: PendingTransaction[] } | { name: 'clear' }>();

	const $actions: Actions = {};
	const actions = writable<Actions>($actions);

	let key: string | undefined;
	async function load(address: `0x${string}`, chainId: string) {
		key = `account_${address}_${chainId}`;
		const dataSTR = localStorage.getItem(key);
		const data: { actions: Actions } = dataSTR ? JSON.parse(dataSTR) : { actions: {} };
		const pending_transactions: PendingTransaction[] = [];
		for (const hash in data.actions) {
			const action = (data.actions as any)[hash];
			($actions as any)[hash] = action;
			pending_transactions.push(fromActionToPendingTransaction(hash as `0x${string}`, action));
		}
		emitter.emit({ name: 'newTx', txs: pending_transactions });
		actions.set($actions);
	}

	async function unload() {
		if (key) {
			//save before unload
			localStorage.setItem(key, JSON.stringify({ actions: $actions }));
		}
		// delete all
		for (const hash of Object.keys($actions)) {
			delete ($actions as any)[hash];
		}
		actions.set($actions);
		emitter.emit({ name: 'clear' });
	}

	function addAction(
		tx: EIP1193TransactionWithMetadata,
		hash: `0x${string}`,
		inclusion?: 'Pending'
	) {
		const action: Action = {
			tx,
			inclusion: inclusion || 'Loading',
			final: undefined,
			status: undefined,
		};

		if (key) {
			// TODO optimize this ? currently write on every add, use dedupe
			localStorage.setItem(key, JSON.stringify({ actions: $actions }));
		}
		$actions[hash] = action;
		actions.set($actions);

		emitter.emit({ name: 'newTx', txs: [fromActionToPendingTransaction(hash, action)] });
	}

	function _updateTx(pendingTransaction: PendingTransaction) {
		const action = $actions[pendingTransaction.hash];
		if (action) {
			action.inclusion = pendingTransaction.inclusion;
			action.status = pendingTransaction.status;
			action.final = pendingTransaction.final;
		}
	}

	function updateTx(pendingTransaction: PendingTransaction) {
		_updateTx(pendingTransaction);
		actions.set($actions);
	}

	function updateTxs(pendingTransactions: PendingTransaction[]) {
		for (const p of pendingTransactions) {
			_updateTx(p);
		}
		actions.set($actions);
	}

	return {
		actions: {
			subscribe: actions.subscribe,
		},

		load,
		unload,
		updateTx,
		updateTxs,

		onTxSent(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`) {
			addAction(tx, hash, 'Pending');
		},

		on: emitter.on,
		off: emitter.off,
	};
}
