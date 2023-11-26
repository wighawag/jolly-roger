import type {EIP1193TransactionWithMetadata} from 'web3-connection';
import type {PendingTransaction, PendingTransactionState} from 'ethereum-tx-observer';
import {initEmitter} from 'radiate';
import {writable} from 'svelte/store';
import {bytesToHex, hexToBytes} from 'viem';
import {AccountDB} from './account-db';

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

export function initAccountData() {
	const emitter = initEmitter<{name: 'newTx'; txs: PendingTransaction[]} | {name: 'clear'}>();

	const $onchainActions: OnChainActions = {};
	const onchainActions = writable<OnChainActions>($onchainActions);

	let accountDB: AccountDB<AccountData> | undefined;
	async function load(info: {
		address: `0x${string}`;
		chainId: string;
		genesisHash: string;
		privateSignature: `0x${string}`;
	}) {
		const key = hexToBytes(info.privateSignature).slice(0, 32);
		const data = await _load({
			address: info.address,
			chainId: info.chainId,
			genesisHash: info.genesisHash,
			key,
		});

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
			if (onchainAction.revealTx) {
				const tx = {
					hash: onchainAction.revealTx.hash,
					request: onchainAction.revealTx.request,
					final: onchainAction.revealTx.final,
					inclusion: onchainAction.revealTx.inclusion,
					status: onchainAction.revealTx.status,
				} as PendingTransaction;
				pending_transactions.push(tx);
			}
		}
		emitter.emit({name: 'newTx', txs: pending_transactions});
	}

	async function unload() {
		//save before unload
		await save();

		accountDB = undefined;

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

	async function _load(info: {
		address: `0x${string}`;
		chainId: string;
		genesisHash: string;
		key: Uint8Array;
	}): Promise<AccountData> {
		const privateKey = info.key;
		accountDB = new AccountDB(info.address, info.chainId, info.genesisHash);
		return (await accountDB.load()) || emptyAccountData;
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

	function _updateTx(pendingTransaction: PendingTransaction) {
		const action = $onchainActions[pendingTransaction.hash];
		if (action) {
			action.inclusion = pendingTransaction.inclusion;
			action.status = pendingTransaction.status;
			action.final = pendingTransaction.final;
		}
	}

	function updateTx(pendingTransaction: PendingTransaction) {
		_updateTx(pendingTransaction);
		onchainActions.set($onchainActions);
		save();
	}

	function updateTxs(pendingTransactions: PendingTransaction[]) {
		for (const p of pendingTransactions) {
			_updateTx(p);
		}
		onchainActions.set($onchainActions);
		save();
	}

	// use with caution
	async function _reset() {
		await unload();
		accountDB?.clearData();
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

		onTxSent(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`) {
			addAction(tx, hash, 'Broadcasted');
			save();
		},

		on: emitter.on,
		off: emitter.off,

		_reset,
	};
}
