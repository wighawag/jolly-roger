import type {EIP1193TransactionWithMetadata} from 'web3-connection';
import type {PendingTransaction} from 'ethereum-tx-observer';
import {initAccount} from '../account';

export type Action = {
	tx: EIP1193TransactionWithMetadata;
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

export type Actions = {[hash: `0x${string}`]: Action};

export type AccountData = {actions: Actions};

export function initAccountData() {
	return initAccount<AccountData, Action>({
		fromAccountDataToActions(data: AccountData): {action: Action; hash: `0x${string}`}[] {
			return Object.keys(data.actions).map((v) => {
				const hash = v as `0x${string}`;
				const action: Action = data.actions[hash];
				return {
					action,
					hash,
				};
			});
		},
		fromActionToPendingTransactions(hash: `0x${string}`, action: Action) {
			return {
				hash,
				request: action.tx,
				final: action.final,
				inclusion: action.inclusion,
				status: action.status,
			} as PendingTransaction;
		},
		addActionFromTransaction(data: AccountData, tx: EIP1193TransactionWithMetadata, hash: `0x${string}`, inclusion) {
			const action: Action = {
				tx,
				inclusion: inclusion || 'BeingFetched',
				final: undefined,
				status: undefined,
			};
			data.actions[hash] = action;
			return action;
		},
		updateActionFromPendingTransactionUpdate(data: AccountData, pendingTransaction: PendingTransaction) {
			const action = data.actions[pendingTransaction.hash];
			if (action) {
				action.inclusion = pendingTransaction.inclusion;
				action.status = pendingTransaction.status;
				action.final = pendingTransaction.final;

				// TODO specific to jolly-roger which does not need user acknowledgement for deleting the actions
				if (action.final) {
					delete data.actions[pendingTransaction.hash];
				}
			}
			return action;
		},
	});
}
