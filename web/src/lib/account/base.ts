import type {PendingTransaction, EIP1193TransactionWithMetadata, PendingTransactionState} from 'ethereum-tx-observer';
import type {AccountHandler, AccountInfo, OnPendingTransaction, SyncInfo} from './types';
import {initEmitter} from 'radiate';
import {AccountDB} from './account-db';
import {writable, type Readable, type Writable} from 'svelte/store';

export type OnChainAction<T> = {
	tx: EIP1193TransactionWithMetadata<T>;
} & PendingTransactionState;
export type OnChainActions<T> = {[hash: `0x${string}`]: OnChainAction<T>};

// TODO export this type in radiate
type Emitter<T> = {
	on: (func: (v: T) => void) => () => void;
	off: (func: (v: T) => void) => void;
	emit(v: T): void;
};

export abstract class BaseAccountHandler<
	T extends {onchainActions: OnChainActions<Metadata>},
	Metadata extends Record<string, unknown>,
> implements AccountHandler<T, Metadata>
{
	private emitter: Emitter<{name: 'newTx'; txs: PendingTransaction[]} | {name: 'clear'}>;

	private accountDB?: AccountDB<T>;
	private unsubscribeFromSync: (() => void) | undefined;
	protected readonly $data: T;
	protected _onchainActions: Writable<OnChainActions<Metadata>>;
	public readonly onchainActions: Readable<OnChainActions<Metadata>>;

	constructor(
		protected dbName: string,
		protected emptyAccountData: T,
		protected fromOnChainActionToPendingTransaction: (
			hash: `0x${string}`,
			onchainAction: OnChainAction<Metadata>,
		) => PendingTransaction,
	) {
		this.emitter = initEmitter();
		this.$data = emptyAccountData;
		this._onchainActions = writable(this.$data.onchainActions);
		this.onchainActions = {
			subscribe: this._onchainActions.subscribe,
		};
	}

	abstract _merge(localData?: T, remoteData?: T): {newData: T; newDataOnLocal: boolean; newDataOnRemote: boolean};

	updateTx(pendingTransaction: PendingTransaction): void {
		if (this._updateTx(pendingTransaction)) {
			this._onchainActions.set(this.$data.onchainActions);
			this._save();
		}
	}
	updateTxs(pendingTransactions: PendingTransaction[]) {
		let anyChanges = false;
		for (const p of pendingTransactions) {
			anyChanges = anyChanges || this._updateTx(p);
		}
		if (anyChanges) {
			this._onchainActions.set(this.$data.onchainActions);
			this._save();
		}
	}
	on(f: (event: {name: 'newTx'; txs: PendingTransaction[]} | {name: 'clear'}) => void): void {
		this.emitter.on(f);
	}
	off(f: OnPendingTransaction): void {
		this.emitter.off(f);
	}
	onTxSent(tx: EIP1193TransactionWithMetadata<any>, hash: `0x${string}`): void {
		this._addAction(tx, hash, 'Broadcasted');
		this._save();
	}
	async load(info: AccountInfo, syncInfo?: SyncInfo): Promise<void> {
		const data = await this._load(info, syncInfo);

		for (const hash in data.onchainActions) {
			const onchainAction = (data.onchainActions as any)[hash];
			(this.$data.onchainActions as any)[hash] = onchainAction;
		}
		this._onchainActions.set(this.$data.onchainActions);
		this._handleTxs(this.$data.onchainActions);
	}
	async unload(): Promise<void> {
		//save before unload
		await this._save();

		if (this.unsubscribeFromSync) {
			this.unsubscribeFromSync();
			this.unsubscribeFromSync = undefined;
		}

		this.accountDB?.destroy();
		this.accountDB = undefined;

		// delete all
		for (const hash of Object.keys(this.$data.onchainActions)) {
			delete (this.$data.onchainActions as any)[hash];
		}

		this._onchainActions.set(this.$data.onchainActions);

		this.emitter.emit({name: 'clear'});
	}

	/// ----------------

	_updateTx(pendingTransaction: PendingTransaction): boolean {
		const action = this.$data.onchainActions[pendingTransaction.hash];
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

	_addAction(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`, inclusion?: 'Broadcasted') {
		if (!tx.metadata) {
			console.error(`no metadata on the tx, we still save it, but this will not let us know what this tx is about`);
		} else if (typeof tx.metadata !== 'object') {
			console.error(`metadata is not an object and so do not conform to Expected Metadata`);
		} else {
			if (!('type' in tx.metadata)) {
				console.error(`no field "type" in the metadata and so do not conform to Expected Metadata`);
			}
		}

		const onchainAction: OnChainAction<Metadata> = {
			tx: tx,
			inclusion: inclusion || 'BeingFetched',
			final: undefined,
			status: undefined,
		};

		this.$data.onchainActions[hash] = onchainAction;
		this._save();
		this._onchainActions.set(this.$data.onchainActions);

		this.emitter.emit({
			name: 'newTx',
			txs: [this.fromOnChainActionToPendingTransaction(hash, onchainAction)],
		});
	}

	async _save() {
		if (this.accountDB) {
			try {
				await this.accountDB.save(this.$data);
			} catch {}
		}
	}

	_handleTxs(onChainActions: OnChainActions<Metadata>) {
		const pending_transactions: PendingTransaction[] = [];
		for (const hash in onChainActions) {
			const onchainAction = (onChainActions as any)[hash];
			const tx = this.fromOnChainActionToPendingTransaction(hash as `0x${string}`, onchainAction);
			pending_transactions.push(tx);
		}
		this.emitter.emit({name: 'newTx', txs: pending_transactions});
	}

	async _load(info: AccountInfo, syncInfo?: SyncInfo): Promise<T> {
		this.accountDB = new AccountDB(this.dbName, info, this._merge, syncInfo);

		this.unsubscribeFromSync = this.accountDB.subscribe(this._onSync);
		return (await this.accountDB.requestSync(true)) || this.emptyAccountData;
	}

	_onSync() {}
}
