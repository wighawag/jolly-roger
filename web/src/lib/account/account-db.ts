import localCache from '$lib/utils/localCache';
import {writable} from 'svelte/store';
import type {Readable, Writable} from 'svelte/store';
import {xchacha20poly1305} from '@noble/ciphers/chacha';
import {randomBytes} from '@noble/ciphers/webcrypto/utils';
import {base64url} from '@scure/base';
import {compressToUint8Array, decompressFromUint8Array} from '$lib/utils/data';
import {privateKeyToAccount, type PrivateKeyAccount} from 'viem/accounts';
import {hexToBytes} from 'viem';
import {time} from '$lib/time';

import {logs} from 'named-logs';
import type {AccountInfo, MergeFunction, SyncInfo} from './types';
const logger = logs('AccountDB');

const LOCAL_STORAGE_PRIVATE_ACCOUNT = '_account';
function LOCAL_STORAGE_KEY(address: string, chainId: string, genesisHash: string) {
	return `${LOCAL_STORAGE_PRIVATE_ACCOUNT}_${address.toLowerCase()}_${chainId}_${genesisHash}`;
}

export type SyncingState<T> = {
	data?: T;
	// syncing: boolean;
	remoteFetchedAtLeastOnce: boolean;
	remoteSyncEnabled: boolean;
	error?: unknown;
};

export class AccountDB<T extends Record<string, unknown>> implements Readable<SyncingState<T>> {
	private _lastId = 1;
	private state: SyncingState<T>;
	private store: Writable<SyncingState<T>>;
	private _lastSyncTime: number | undefined;
	private _syncDelay: NodeJS.Timeout | undefined;

	private _dbName: string;
	private _signer: PrivateKeyAccount | undefined;
	private privateKey: Uint8Array | undefined;
	public readonly syncURI: string | undefined;
	private _periodicalSync: NodeJS.Timeout | undefined;

	// private destroyed = false;
	constructor(
		dbName: string,
		protected accountInfo: AccountInfo,
		protected merge: MergeFunction<T>,
		syncInfo?: SyncInfo,
	) {
		if (accountInfo.localKey) {
			this.privateKey = hexToBytes(accountInfo.localKey);
			this._signer = privateKeyToAccount(accountInfo.localKey);
		}

		this._dbName = dbName + `-${accountInfo.genesisHash}`;
		this.syncURI = syncInfo?.uri;

		if (!this.syncURI) {
			logger.debug(`no syncURI provided, disabling remote sync...`);
		}

		this.state = {
			data: undefined,
			// syncing: false,
			remoteFetchedAtLeastOnce: false,
			remoteSyncEnabled: !!this.syncURI && !!accountInfo.localKey,
		};
		this.store = writable(this.state);

		this._periodicalSync = setTimeout(this._syncPeriodically.bind(this), 10 * 1000);
	}

	_syncPeriodically() {
		this._periodicalSync = setTimeout(this._syncPeriodically.bind(this), 10 * 1000);
		this._syncNow();
	}

	destroy() {
		if (this._periodicalSync) {
			clearTimeout(this._periodicalSync);
		}

		if (this._syncDelay) {
			clearTimeout(this._syncDelay);
		}
	}

	subscribe(run: (value: SyncingState<T>) => void, invalidate?: (value?: SyncingState<T>) => void): () => void {
		return this.store.subscribe(run, invalidate);
	}

	_syncNow() {
		logger.info(`SYNC: _syncNow`);
		clearTimeout(this._syncDelay);
		this._syncDelay = undefined;
		this._syncRemote();
	}

	_syncLater() {
		if (!this._syncDelay) {
			if (this._lastSyncTime && time.now - this._lastSyncTime < 2) {
				this._syncDelay = setTimeout(this._syncNow.bind(this), 2000);
			} else {
				logger.info(`SYNC: _syncRemote now`);
				this._syncRemote();
			}
		} else {
			logger.info(`SYNC: _skip`);
		}
	}

	async save(data: T): Promise<void> {
		this.state.data = data;
		const notified = await this._syncLocal();
		if (!notified) {
			this._notify('save');
		}

		logger.info(`SYNC: _syncLater after save`);
		this._syncLater();
	}

	async requestSync(waitForRemote?: boolean): Promise<T | undefined> {
		const notified = await this._syncLocal();
		if (!notified) {
			this._notify('requestSync');
		}
		if (waitForRemote) {
			await this._syncRemote();
		} else {
			this._syncRemote();
		}

		return this.state.data;
	}

	async clearData(): Promise<void> {
		this.state.data = {} as T;
		await this._saveToLocalStorage(this.state.data);

		if (this.state.remoteSyncEnabled) {
			let error: unknown | undefined = undefined;
			let counter: bigint = 0n;
			try {
				const remoteResult = await this._fetchRemoteData();
				counter = remoteResult.counter;
			} catch (e) {
				console.error(e);
				error = e;
			}

			if (!error) {
				this._postToRemote(this.state.data, counter);
			}
		}

		// this.state.syncing = false;
		this._notify('clearData');
	}

	private async _syncRemote(): Promise<void> {
		this._lastSyncTime = time.now;
		if (!this.state.remoteSyncEnabled) {
			return;
		}
		// this.state.syncing = true;
		// this._notify('_syncRemote, syncing: true');

		let error: unknown | undefined = undefined;
		let remoteData: T | undefined;
		let counter: bigint = 0n;
		try {
			const remoteResult = await this._fetchRemoteData();
			remoteData = remoteResult.data;
			counter = remoteResult.counter;
		} catch (e) {
			console.error(e);
			error = e;
		}

		if (!error && remoteData) {
			const {newData, newDataOnLocal, newDataOnRemote} = this.merge(this.state.data, remoteData);
			if (newDataOnRemote) {
				this.state.data = newData;
				const notified = await this._syncLocal();
				if (!notified) {
					this._notify('_syncRemote, _syncLocal');
				}
			}
			if (newDataOnLocal && this.state.data) {
				this._postToRemote(this.state.data, counter);
			}
			this.state.remoteFetchedAtLeastOnce = true;
		}

		// this.state.syncing = false;
		// this._notify('_syncRemote, syncing: false');
	}

	private async _syncLocal(): Promise<boolean> {
		let notified = false;
		const localStorageAsRemoteData = await this._getFromLocalStorage();
		const {newData, newDataOnLocal, newDataOnRemote} = this.merge(this.state.data, localStorageAsRemoteData);
		if (!this.state.data) {
			this.state.data = newData;
		}
		if (newDataOnRemote) {
			this.state.data = newData;
			this._notify('_syncLocal: newDataOnRemote');
			notified = true;
		}
		if (newDataOnLocal) {
			await this._saveToLocalStorage(this.state.data);
		}
		return notified;
	}

	// destroy(): void {
	//   this.destroyed = true;
	// }

	private async _getFromLocalStorage(): Promise<T | undefined> {
		const key = LOCAL_STORAGE_KEY(this.accountInfo.address, this.accountInfo.chainId, this.accountInfo.genesisHash);
		const fromStorage = await localCache.getItem(key);
		if (fromStorage) {
			try {
				const decrypted = this.accountInfo.doNotEncryptLocally ? fromStorage : this._decrypt(fromStorage);
				return JSON.parse(decrypted);
			} catch (e) {
				if (this.accountInfo.doNotEncryptLocally) {
					// we might have switched from encrypted
					try {
						const decrypted = this._decrypt(fromStorage);
						return JSON.parse(decrypted);
					} catch (e) {
						console.error(e);
					}
				} else {
					try {
						const decrypted = fromStorage;
						return JSON.parse(decrypted);
					} catch (e) {
						console.error(e);
					}
				}
			}
		}
		return undefined;
	}

	private async _saveToLocalStorage(data: T): Promise<void> {
		const toStorage = JSON.stringify(data);

		const encrypted = this.accountInfo.doNotEncryptLocally ? toStorage : this._encrypt(toStorage);
		await localCache.setItem(
			LOCAL_STORAGE_KEY(this.accountInfo.address, this.accountInfo.chainId, this.accountInfo.genesisHash),
			encrypted,
		);
	}

	private async _fetchRemoteData(): Promise<{data: T; counter: bigint}> {
		if (!this._signer) {
			throw new Error(`no signer, do not sync`);
		}
		let response: Response;
		try {
			response = await this._syncRequest('wallet_getString', [this._signer.address, this._dbName]);
		} catch (e) {
			console.error(e);
			throw e;
		}

		const json = await response.json();
		if (json.error) {
			throw new Error(json.error); // TODO retry before throw
		}
		let data: T;
		if (json.result.data && json.result.data !== '') {
			try {
				const decryptedData = this._decrypt(json.result.data);
				data = JSON.parse(decryptedData);
			} catch (err: any) {
				console.error(err);
				throw new Error(err);
			}
		} else {
			data = {} as T;
		}
		return {data, counter: BigInt(json.result.counter)};
	}

	private async _postToRemote(data: T, syncDownCounter: bigint): Promise<void> {
		if (!this._signer) {
			throw new Error(`no signer, do not sync`);
		}
		const dataToEncrypt = JSON.stringify(data);
		const encryptedData = this._encrypt(dataToEncrypt);

		const counter = (syncDownCounter + 1n).toString();
		const signature = await this._signer.signMessage({
			message: 'put:' + this._dbName + ':' + counter + ':' + encryptedData,
		});

		let json;
		let error;
		try {
			const response = await this._syncRequest('wallet_putString', [
				this._signer.address,
				this._dbName,
				counter,
				encryptedData,
				signature,
			]);
			json = await response.json();
			if (json.error) {
				throw new Error(json.error);
			}
		} catch (e) {
			error = e;
		}
		if (error || json.error) {
			console.error(error || json.error);
			return; // TODO retry ?
		}
		if (!json.result || !json.result.success) {
			console.error('sync no success', json);
			return; // TODO retry ?
		} else {
			// logger.info('synced!');
		}
	}

	private async _syncRequest(method: string, params: string[]): Promise<Response> {
		if (!this.syncURI) {
			throw new Error(`no sync URI`);
		}
		return fetch(this.syncURI, {
			// TODO env variable
			method: 'POST',
			body: JSON.stringify({
				method,
				params,
				jsonrpc: '2.0',
				id: ++this._lastId,
			}),
			headers: {
				'Content-type': 'application/json; charset=UTF-8',
			},
		});
	}

	private _encrypt(data: string): string {
		if (!this.privateKey) {
			throw new Error(`no signer, do not encrypt`);
		}

		const nonce24 = randomBytes(24); // 192-bit nonce
		const stream = xchacha20poly1305(this.privateKey, nonce24);
		const dataBytes = compressToUint8Array(data);
		const ciphertext = stream.encrypt(dataBytes);
		return `~${base64url.encode(nonce24)}~${base64url.encode(ciphertext)}`;
	}

	private _decrypt(data: string): string {
		if (!this.privateKey) {
			throw new Error(`no signer, do not decrypt`);
		}
		const secondDoubleColumnIndex = data.slice(1).indexOf('~');
		const nonceString = data.slice(1, secondDoubleColumnIndex + 1);
		const nonce24 = base64url.decode(nonceString);
		const stream_xc = xchacha20poly1305(this.privateKey, nonce24);

		const dataString = data.slice(secondDoubleColumnIndex + 2);
		const ciphertext = base64url.decode(dataString);
		const plaintext_xc = stream_xc.decrypt(ciphertext);
		return decompressFromUint8Array(plaintext_xc);
	}

	private _notify(message: string): void {
		logger.info(`AccountDB:notify: ${message}`);
		this.store.set(this.state);
	}
}
