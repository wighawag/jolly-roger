import type {EIP1193TransactionWithMetadata} from 'web3-connection';
import type {PendingTransaction} from 'ethereum-tx-observer';
import {BaseAccountHandler, type OnChainAction, type OnChainActions} from './base';
import {mainnetClient, createClient} from '$lib/fuzd';
import type {AccountInfo, SyncInfo} from './types';
import {FUZD_URI} from '$lib/config';

export type SendMessageMetadata = {
	type: 'message';
	message: string;
};
export type JollyRogerMetadata = SendMessageMetadata;

export type JollyRogerTransaction = EIP1193TransactionWithMetadata & {
	metadata?: JollyRogerMetadata;
};

export type AccountData = {
	onchainActions: OnChainActions<JollyRogerMetadata>;
};

function fromOnChainActionToPendingTransaction(
	hash: `0x${string}`,
	onchainAction: OnChainAction<JollyRogerMetadata>,
): PendingTransaction {
	return {
		hash,
		request: onchainAction.tx,
		final: onchainAction.final,
		inclusion: onchainAction.inclusion,
		status: onchainAction.status,
	} as PendingTransaction;
}

export class JollyRogerAccountData extends BaseAccountHandler<AccountData, JollyRogerMetadata> {
	fuzdClient: ReturnType<typeof createClient> | undefined;

	constructor() {
		super(
			'jolly-roger',
			() => ({
				onchainActions: {},
			}),
			fromOnChainActionToPendingTransaction,
		);
	}

	async load(info: AccountInfo, syncInfo?: SyncInfo): Promise<void> {
		if (FUZD_URI) {
			if (!info.localKey) {
				throw new Error(`no local key, FUZD requires it`);
			}
			this.fuzdClient = createClient({
				drand: mainnetClient(),
				privateKey: info.localKey,
				schedulerEndPoint: FUZD_URI,
			});
		}
		return super.load(info, syncInfo);
	}

	unload() {
		this.fuzdClient = undefined;
		return super.unload();
	}

	_merge(
		localData?: AccountData | undefined,
		remoteData?: AccountData | undefined,
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

	async getFuzd() {
		if (!this.fuzdClient) {
			throw new Error(`no fuzd client setup`);
		}
		const remoteAccount = await this.fuzdClient.getRemoteAccount();
		const self = this;
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
				if (!self.fuzdClient) {
					throw new Error(`no fuzd client setup`);
				}
				return self.fuzdClient.scheduleExecution(execution, options);
			},
		};
	}
}
