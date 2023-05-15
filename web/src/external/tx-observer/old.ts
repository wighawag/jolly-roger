import {writable} from 'svelte/store';
import type {EIP1193Provider} from 'eip-1193';
import type {EIP1193TransactionWithMetadata} from 'web3-connection';

export type PendingTransactionInclusion = 'BeingFetched' | 'Broadcasted' | 'NotFound' | 'Cancelled' | 'Included';
export type PendingTransaction = {
	hash: `0x${string}`;
	request: EIP1193TransactionWithMetadata;
} & (
	| {
			inclusion: 'BeingFetched' | 'Broadcasted' | 'NotFound' | 'Cancelled';
			final: undefined;
			status: undefined;
	  }
	| {
			inclusion: 'Included';
			status: 'Failure' | 'Success';
			final: number;
	  }
);

export function initTransactionObserver(config: {finality: number}) {
	let provider: EIP1193Provider | undefined;
	const $txs: PendingTransaction[] = [];
	const store = writable<PendingTransaction[]>($txs);
	const map: {[hash: string]: PendingTransaction} = {};

	function addTx(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`, inclusion?: 'Broadcasted') {
		if (!map[hash]) {
			const pendingTransaction: PendingTransaction = {
				hash,
				request: tx,
				inclusion: inclusion || 'BeingFetched',
				final: undefined,
				status: undefined,
			};
			map[hash] = pendingTransaction;
			$txs.push(pendingTransaction);
			store.set($txs);
		}
	}

	function removeTx(hash: string) {
		const pendingTransaction = map[hash];
		if (pendingTransaction) {
			const index = $txs.indexOf(pendingTransaction);
			if (index >= 0) {
				$txs.splice(index, 1);
				store.set($txs);
			}
			delete map[hash];
		}
	}

	async function process() {
		if (!provider) {
			return;
		}

		const latestBlock = await provider.request({
			method: 'eth_getBlockByNumber',
			params: ['latest', false],
		});

		const latestBlockNumber = parseInt(latestBlock.number.slice(2), 16);

		const latestFinalizedBlockNumber = Math.max(latestBlockNumber - config.finality, 0);

		const latestFinalizedBlock = await provider.request({
			method: 'eth_getBlockByNumber',
			params: [`0x${latestFinalizedBlockNumber.toString(16)}`, false],
		});
		const account = '0x'; // TODO checkedAction.action.txOrigin || ownerAddress;
		const tranactionCount = await provider.request({
			method: 'eth_getTransactionCount',
			params: [account, latestFinalizedBlock.hash],
		});
		const finalityNonce = parseInt(tranactionCount.slice(2), 16);

		let changes = false;
		for (const tx of $txs) {
			const newChanges = await processTx(tx, {
				latestBlockNumber,
				latestFinalizedBlockNumber,
				finalityNonce,
			});
			// TODO skip if account / network changes
			changes = changes || newChanges;
		}

		if (changes) {
			// TODO a store per tx ?
			// TODO we could also set the changes on each tx inside processTx
			store.set($txs);
		}
	}

	async function processTx(
		tx: PendingTransaction,
		{
			latestBlockNumber,
			finalityNonce,
		}: {
			latestBlockNumber: number;
			latestFinalizedBlockNumber: number;
			finalityNonce: number;
		}
	): Promise<boolean> {
		if (!provider) {
			return false;
		}

		if (tx.inclusion === 'Included') {
			if (tx.final) {
				// TODO auto remove ?
				return false;
			}
		}

		const txFromPeers = await provider.request({
			method: 'eth_getTransactionByHash',
			params: [tx.hash],
		});

		let changes = false;
		if (txFromPeers) {
			let receipt;
			if (txFromPeers.blockNumber) {
				receipt = await provider.request({
					method: 'eth_getTransactionReceipt',
					params: [tx.hash],
				});
			}
			if (receipt) {
				const block = await provider.request({
					method: 'eth_getBlockByHash',
					params: [txFromPeers.blockHash, false],
				});
				if (block) {
					const blockNumber = parseInt(block.number.slice(2), 16);
					const blockTimestamp = parseInt(block.timestamp.slice(2), 16);
					const is_final = latestBlockNumber - blockNumber >= config.finality;
					if (receipt.status === '0x0' || receipt.status === '0x00') {
						if (tx.status !== 'Failure' || tx.final !== blockTimestamp) {
							tx.status = 'Failure';
							tx.final = is_final ? blockTimestamp : undefined;
							changes = true;
						}
					} else {
						if (tx.status !== 'Success' || tx.final !== blockTimestamp) {
							tx.status = 'Success';
							tx.final = is_final ? blockTimestamp : undefined;
							changes = true;
						}
					}
				}
			} else {
				if (tx.inclusion !== 'Broadcasted') {
					tx.inclusion = 'Broadcasted';
					changes = true;
				}
			}
		} else {
			// NOTE: we feteched it again to ensure the call was not lost
			const txFromPeers = await provider.request({
				method: 'eth_getTransactionByHash',
				params: [tx.hash],
			});
			if (txFromPeers) {
				return false; // we skip it for now
			}
			if (typeof tx.request.nonce === 'number' && finalityNonce > tx.request.nonce) {
				if (tx.inclusion !== 'Cancelled' || !tx.final) {
					tx.inclusion = 'Cancelled';
					tx.final = tx.request.timestamp;
					changes = true;
				}
			} else {
				if (tx.inclusion !== 'NotFound') {
					tx.inclusion = 'NotFound';
					tx.final = undefined;
					changes = true;
				}
			}
		}

		return changes;
	}

	return {
		// we probably do not want to hook it up directly to web3-connection observers
		// most likely we want an account data store to be the observer and store the tx as they come, to ensure they are saved as soon as possible
		// then the account store can notify the tx observer to start processing
		// similarly on account loaded or switched, we will want to delete the tx
		// also we need to consider the provider changing ?

		// onTxSent(tx: EIP1193TransactionWithMetadata, hash: string) {
		// 	addTx(tx, hash, 'Broadcasted');
		// },
		add(tx: EIP1193TransactionWithMetadata, hash: `0x${string}`) {
			addTx(tx, hash);
		},
		remove(hash: string) {
			removeTx(hash);
		},
		txs: {
			subscribe: store.subscribe,
		},
		setProvider(newProvider: EIP1193Provider) {
			provider = newProvider;
		},
		process,
	};
}
