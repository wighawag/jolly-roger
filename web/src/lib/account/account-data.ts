import type {EIP1193TransactionWithMetadata} from 'web3-connection';
import type {PendingTransaction} from 'ethereum-tx-observer';
import {BaseAccountHandler, type OnChainAction, type OnChainActions} from './base';

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
	constructor() {
		super(
			'jolly-roger',
			() => ({
				onchainActions: {},
			}),
			fromOnChainActionToPendingTransaction,
		);
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
}
