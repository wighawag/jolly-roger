import {derived} from 'svelte/store';
import {state, syncing} from './State';
import {accountData} from '$lib/web3';
import {getAddress} from 'viem';
import {createDraft, finishDraft} from 'immer';
import {Registry} from 'jolly-roger-common';

import {logs} from 'named-logs';
const logger = logs(`pending-state`);

const registry = new Registry();

/**
 * Here we are deriving a new state from the indexer state and the account data
 * This allow us to optimistically update the UI with pending messages from the user
 *
 */
export const viewState = derived(
	[syncing, state, accountData.onchainActions],
	([$syncing, $state, $onchainActions]) => {
		logger.info(`num greetings: ${$state.greetings.length}`);

		const pendingMessages: {[from: `0x${string}`]: string} = {};

		const transactionsAlreadyIndexed: {[hash: string]: boolean} = {};
		if ($syncing.lastSync && $syncing.lastSync.unconfirmedBlocks) {
			for (const block of $syncing.lastSync.unconfirmedBlocks) {
				for (const event of block.events) {
					transactionsAlreadyIndexed[event.transactionHash] = true;
				}
			}
		}

		if ($onchainActions) {
			for (const hash of Object.keys($onchainActions)) {
				if (transactionsAlreadyIndexed[hash]) {
					// if tx is already considered in the index, we can skip
					continue;
				}

				const action = $onchainActions[hash as `0x${string}`];

				if (action.status === 'Failure') {
					// tx failed so we can ignore it
					// TODO? this failure can be picked up elsewhere to let the user know
					//  but we could also modify the ViewState type to include information here
					continue;
				}

				if (action.final) {
					// onchain Action is final, can track back from index
					// we could check if indexer is up to speed though
					// best is to simply skip here
					// and if indexer is not up to speed, we can deal with it in the UI elsewere
					continue;
				}

				switch (action.inclusion) {
					case 'Cancelled':
						// tx cancelled, we ignore it
						continue;
					case 'BeingFetched':
						// TODO add to state that loading is still going for txs....
						// tx state is loading
						continue;
					case 'Included':
					case 'NotFound':
					case 'Broadcasted':
					// else we consider it
				}
				if (action.tx.metadata && typeof action.tx.metadata === 'object' && 'message' in action.tx.metadata) {
					const fromAccount = getAddress(action.tx.from);
					pendingMessages[fromAccount] = action.tx.metadata.message as string;
				}
			}
		}

		const accounts = Object.keys(pendingMessages);
		if (accounts.length > 0) {
			const pending = createDraft($state);
			registry.handle(pending, true);

			for (const from of accounts) {
				const account = from as `0x${string}`;
				registry.setMessageFor(account, pendingMessages[account], 0); // TODO dayTimeInSeconds ?
			}

			return finishDraft(pending);
		} else {
			return $state;
		}
	},
);

if (typeof window !== 'undefined') {
	(window as any).viewState = viewState;
}
