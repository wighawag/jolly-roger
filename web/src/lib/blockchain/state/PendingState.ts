import {derived} from 'svelte/store';
import {state, syncing} from './State';
import {accountData} from '$lib/web3';
import {getAddress} from 'viem';

import {logs} from 'named-logs';
const logger = logs(`pending-state`);

/**
 * Here we are deriving a new state from the indexer state and the account data
 * This allow us to optimistically update the UI with pending messages from the user
 *
 */
export const pendingState = derived([syncing, state, accountData.data], ([$syncing, $state, $accountData]) => {
	const pendingGreetings: {account: `0x${string}`; message: string; pending: boolean}[] = $state.greetings.map((v) => ({
		message: v.message,
		account: v.account,
		pending: false,
	}));

	logger.info(`num greetings: ${$state.greetings.length}`);

	const accountIndexes: {[from: `0x${string}`]: number} = {};
	for (let i = 0; i < pendingGreetings.length; i++) {
		accountIndexes[pendingGreetings[i].account] = i;
		logger.info(`${i}: ${pendingGreetings[i].account}`);
	}

	const pendingMessages: {[from: `0x${string}`]: string} = {};

	const pendingHashes: {[hash: string]: boolean} = {};
	if ($syncing.lastSync && $syncing.lastSync.unconfirmedBlocks) {
		for (const block of $syncing.lastSync.unconfirmedBlocks) {
			for (const event of block.events) {
				pendingHashes[event.transactionHash] = true;
			}
		}
	}

	if ($accountData) {
		for (const hash of Object.keys($accountData.actions)) {
			const action = $accountData.actions[hash as `0x${string}`];
			if (action.final) {
				// in this case, the indexer will pick the correct state once synced up
				// we can ignore the pending tx
				// the tx-broadcaster should stop caring about this one
				continue;
			}
			if (action.status === 'Failure') {
				// tx failed so we can ignore it
				// TODO? this failure can be picked up elsewhere to let the user know
				//  but we could also modify the PendingState type to include information here
				continue;
			}

			if (pendingHashes[hash]) {
				// if tx is already considered in the index, we can skip
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

	for (const from of Object.keys(pendingMessages)) {
		const account = from as `0x${string}`;
		const i = accountIndexes[account];
		if (isNaN(i)) {
			logger.info(`new: ${account}`);
			pendingGreetings.push({
				account,
				message: pendingMessages[account],
				pending: true,
			});
		} else {
			logger.info(`${pendingGreetings[i].message} and ${pendingMessages[account]}`);
			// remove that when `if (indexer.includes(hash)) {continue;}` is implemented
			if (pendingGreetings[i].message != pendingMessages[account]) {
				pendingGreetings[i].message = pendingMessages[account];
				pendingGreetings[i].pending = true;
			}
		}
	}

	return {
		greetings: pendingGreetings,
	};
});

if (typeof window !== 'undefined') {
	(window as any).pendingState = pendingState;
}
