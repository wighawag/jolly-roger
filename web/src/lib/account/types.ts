import type {EIP1193TransactionWithMetadata, PendingTransaction} from 'ethereum-tx-observer';

export type AccountInfo = {
	address: `0x${string}`;
	chainId: string;
	genesisHash: string;
	localKey?: `0x${string}`;
	doNotEncryptLocally?: boolean;
};

export type SyncInfo = {uri: string; enabled?: boolean};

export type MergeFunction<T> = (
	localData?: T,
	remoteData?: T,
) => {newData: T; newDataOnLocal: boolean; newDataOnRemote: boolean};

export type OnPendingTransaction = (
	event:
		| {
				name: 'newTx';
				txs: PendingTransaction[];
		  }
		| {
				name: 'clear';
		  },
) => void;

export type AccountHandler<T, Metadata> = {
	updateTx(pendingTransaction: PendingTransaction): void;
	on(f: OnPendingTransaction): void;
	off: (func: OnPendingTransaction) => void;
	onTxSent(tx: EIP1193TransactionWithMetadata<any>, hash: `0x${string}`): void;
	load: (info: AccountInfo, syncInfo?: SyncInfo) => Promise<void>;
	unload(): Promise<void>;
};
