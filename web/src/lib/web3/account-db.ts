import localCache from '$lib/utils/localCache';

import {logs} from 'named-logs';
const logger = logs('AccountDB');

const LOCAL_STORAGE_PRIVATE_ACCOUNT = '_account';
function LOCAL_STORAGE_KEY(address: string, chainId: string, genesisHash: string) {
	return `${LOCAL_STORAGE_PRIVATE_ACCOUNT}_${address.toLowerCase()}_${chainId}_${genesisHash}`;
}

export class AccountDB<T extends Record<string, any>> {
	constructor(
		public readonly ownerAddress: string,
		public readonly chainId: string,
		public readonly genesisHash: string,
	) {}

	async save(data: T): Promise<void> {
		this._saveToLocalStorage(data);
	}

	async clearData(): Promise<void> {
		await this._saveToLocalStorage({} as T);
	}

	async load(): Promise<T | undefined> {
		return this._getFromLocalStorage();
	}

	private async _getFromLocalStorage(): Promise<T | undefined> {
		const fromStorage = await localCache.getItem(LOCAL_STORAGE_KEY(this.ownerAddress, this.chainId, this.genesisHash));
		if (fromStorage) {
			try {
				return JSON.parse(fromStorage);
			} catch (e) {
				console.error(e);
			}
		}
		return undefined;
	}

	private async _saveToLocalStorage(data: T): Promise<void> {
		const toStorage = JSON.stringify(data);
		await localCache.setItem(LOCAL_STORAGE_KEY(this.ownerAddress, this.chainId, this.genesisHash), toStorage);
	}
}
