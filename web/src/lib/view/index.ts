import {derived, type Readable} from 'svelte/store';
import type {Message, OnchainStateStore} from '$lib/onchain/state';
import type {Schema} from '$lib/account/AccountData';
import type {FieldReadable} from 'synqable';

export type MessageView = Message & {pending?: boolean};

// New types for dual-store architecture
export type ViewStateValue =
	{step: 'Unloaded'} | {step: 'Loaded'; messages: MessageView[]};

export type ViewStateStatus = {
	loading: boolean;
	error?: {message: string};
	lastSuccessfulFetch?: number;
};

export type ViewStateStore = {
	subscribe: Readable<ViewStateValue>['subscribe'];
	status: Readable<ViewStateStatus>;
};

export function createViewState(params: {
	onchainState: OnchainStateStore;
	operations: FieldReadable<Schema, 'operations'>;
	config: {
		maxMessages: number;
	};
}): ViewStateStore {
	const {onchainState, operations, config} = params;

	// Main store - derives from onchainState + operations
	const _mainStore = derived(
		[{subscribe: onchainState.subscribe}, operations],
		([$onchainState, $operations]): ViewStateValue => {
			if ($onchainState.step === 'Unloaded') {
				return {step: 'Unloaded'};
			}

			const messageViews: MessageView[] = [];
			for (const message of $onchainState.messages) {
				messageViews.push({...message});
			}

			const inclusionsToIgnore = ['NotFound', 'Dropped'];

			// First, filter to get only valid setMessage operations
			const validOperations: Array<{
				operationID: string;
				operation: (typeof $operations)[string];
			}> = [];
			for (const operationID of Object.keys($operations)) {
				const operation = $operations[operationID];
				if (
					operation.transactionIntent.state?.status !== 'Failure' &&
					!inclusionsToIgnore.some(
						(v) => operation.transactionIntent.state?.inclusion === v,
					) &&
					operation.metadata.type === 'functionCall' &&
					operation.metadata.functionName === 'setMessage'
				) {
					validOperations.push({operationID, operation});
				}
			}

			/**
			 * Compare two operations to determine which is "later".
			 * Returns true if `current` should replace `existing`.
			 *
			 * Comparison order (most significant first):
			 * 1. Higher nonce wins (later transaction)
			 * 2. Same nonce: higher timestamp wins (later broadcast)
			 * 3. Same nonce + timestamp: lexicographically greater operationID wins (deterministic tiebreaker)
			 *
			 * The operationID tiebreaker ensures deterministic results even under race conditions
			 * where two operations with identical nonce/timestamp are being processed.
			 */
			function isLaterOperation(
				current: (typeof validOperations)[number],
				existing: (typeof validOperations)[number],
			): boolean {
				const currentNonce = current.operation.metadata.tx.nonce;
				const existingNonce = existing.operation.metadata.tx.nonce;

				// Higher nonce wins
				if (currentNonce !== existingNonce) {
					return currentNonce > existingNonce;
				}

				const currentTimestamp =
					current.operation.metadata.tx.broadcastTimestampMs;
				const existingTimestamp =
					existing.operation.metadata.tx.broadcastTimestampMs;

				// Same nonce: higher timestamp wins
				if (currentTimestamp !== existingTimestamp) {
					return currentTimestamp > existingTimestamp;
				}

				// Same nonce + timestamp: use operationID as deterministic tiebreaker
				// This ensures consistent results regardless of iteration order
				return current.operationID > existing.operationID;
			}

			// Group operations by account and find the latest for each account
			const latestOperationByAccount = new Map<
				string,
				(typeof validOperations)[number]
			>();
			for (const entry of validOperations) {
				const account = entry.operation.metadata.tx.from.toLowerCase();
				const existing = latestOperationByAccount.get(account);
				if (!existing || isLaterOperation(entry, existing)) {
					latestOperationByAccount.set(account, entry);
				}
			}

			// Apply the latest operation for each account to the view
			for (const entry of latestOperationByAccount.values()) {
				const operation = entry.operation;
				const account = operation.metadata.tx.from;
				const time = operation.metadata.tx.broadcastTimestampMs;
				const metadata = operation.metadata as {args?: unknown[]};
				const message = (metadata.args?.[0] as string) || '';

				const existingMessageIndex = messageViews.findIndex(
					(v) => v.account.toLowerCase() === account.toLowerCase(),
				);

				if (existingMessageIndex >= 0) {
					const existingMessageObject = messageViews[existingMessageIndex];
					if (
						existingMessageObject.message === message &&
						existingMessageObject.timestamp > time
					) {
						continue;
					}
					messageViews.splice(existingMessageIndex, 1);
				}

				messageViews.unshift({
					account,
					message,
					timestamp: time,
					pending: operation.transactionIntent.state?.inclusion !== 'Included',
				});
			}

			messageViews.splice(config.maxMessages);

			return {step: 'Loaded', messages: messageViews};
		},
	);

	// Status store - pass through from onchainState.status
	const _statusStore = derived(
		onchainState.status,
		($status): ViewStateStatus => ({...$status}),
	);

	return {
		subscribe: _mainStore.subscribe,
		status: {subscribe: _statusStore.subscribe},
	};
}
