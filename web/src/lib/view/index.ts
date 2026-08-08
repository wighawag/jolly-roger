import {derived, type Readable} from 'svelte/store';
import type {Message, OnchainStateStore} from '$lib/onchain/state';
import type {OnchainOperation, Schema} from '$lib/account/AccountData';
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

type Operations = Record<string, OnchainOperation>;
type Entry = {operationID: string; operation: OnchainOperation};

/**
 * Is `current` the later of the two?
 *
 * Comparison order, most significant first:
 * 1. Higher nonce wins (later transaction).
 * 2. Same nonce: higher broadcast timestamp wins (a resubmit of the same slot).
 * 3. Same nonce and timestamp: greater operationID, purely as a deterministic
 *    tiebreaker, so a race between two identically-stamped operations does not
 *    produce a different answer depending on iteration order.
 */
function isLater(current: Entry, existing: Entry): boolean {
	const currentTx = current.operation.metadata.tx;
	const existingTx = existing.operation.metadata.tx;

	if (currentTx.nonce !== existingTx.nonce) {
		return currentTx.nonce > existingTx.nonce;
	}
	if (currentTx.broadcastTimestampMs !== existingTx.broadcastTimestampMs) {
		return currentTx.broadcastTimestampMs > existingTx.broadcastTimestampMs;
	}
	return current.operationID > existing.operationID;
}

/**
 * The most recent greeting this account has sent but not yet seen confirmed.
 *
 * ONE of them, not one per address. Operations are stored per authenticated
 * account (see account/AccountData, where the storage key ends in the account),
 * so everything here already belongs to the same player, and a greeting
 * replaces that player's previous one.
 */
function latestGreeting(operations: Operations): Entry | undefined {
	const ignoredInclusions = ['NotFound', 'Dropped'];

	let latest: Entry | undefined;
	for (const operationID of Object.keys(operations)) {
		const operation = operations[operationID];
		const state = operation.transactionIntent.state;

		if (state?.status === 'Failure') continue;
		if (state && ignoredInclusions.includes(state.inclusion)) continue;
		if (operation.metadata.type !== 'functionCall') continue;
		if (
			operation.metadata.functionName !== 'setMessage' &&
			operation.metadata.functionName !== 'setMessageFor'
		) {
			continue;
		}

		const entry = {operationID, operation};
		if (!latest || isLater(entry, latest)) {
			latest = entry;
		}
	}
	return latest;
}

/**
 * The greeting the operation is trying to set.
 *
 * Which argument that is depends on the function: `setMessage(message)` is sent
 * by the greeter itself, `setMessageFor(owner, message)` by an address acting
 * for them. Reading it positionally is why this has to know the difference.
 */
function messageArgOf(operation: OnchainOperation): string {
	const metadata = operation.metadata as {
		functionName?: string;
		args?: unknown[];
	};
	const index = metadata.functionName === 'setMessageFor' ? 1 : 0;
	return (metadata.args?.[index] as string) || '';
}

/**
 * What to show: the chain's greetings, with this account's un-confirmed one
 * laid over the top.
 *
 * The pending greeting is attributed to the AUTHENTICATED ACCOUNT, never to
 * whichever address signed the transaction. Those can differ: an app that acts
 * on its user's behalf sends from a key of its own, and the registry attributes
 * the greeting to the account that key represents. Keying off the sender would
 * file the optimistic entry under an address the chain will never report, so it
 * would sit in the list as a second, permanent duplicate of a greeting that did
 * in fact confirm.
 *
 * Pure, so the merge rules can be argued with in tests rather than by getting a
 * transaction into exactly the right state.
 */
export function applyPendingOperations(params: {
	messages: readonly Message[];
	operations: Operations;
	/** The account these operations belong to, or undefined when signed out. */
	account: `0x${string}` | undefined;
	maxMessages: number;
}): MessageView[] {
	const {messages, operations, account, maxMessages} = params;

	const views: MessageView[] = messages.map((message) => ({...message}));

	// No account means no operations to overlay: the store they come from is
	// per-account and has nothing to hand out until one is connected.
	const latest = account ? latestGreeting(operations) : undefined;

	if (latest) {
		const time = latest.operation.metadata.tx.broadcastTimestampMs;
		const message = messageArgOf(latest.operation);

		const existingIndex = views.findIndex(
			(view) => view.account.toLowerCase() === account!.toLowerCase(),
		);

		// Keep the confirmed one when it says the same thing more recently: the
		// pending entry is then just a stale echo of a greeting already landed.
		const supersededByChain =
			existingIndex >= 0 &&
			views[existingIndex].message === message &&
			views[existingIndex].timestamp > time;

		if (!supersededByChain) {
			if (existingIndex >= 0) {
				views.splice(existingIndex, 1);
			}
			views.unshift({
				account: account!,
				message,
				timestamp: time,
				pending:
					latest.operation.transactionIntent.state?.inclusion !== 'Included',
			});
		}
	}

	views.splice(maxMessages);
	return views;
}

export function createViewState(params: {
	onchainState: OnchainStateStore;
	operations: FieldReadable<Schema, 'operations'>;
	/**
	 * The authenticated account. What a pending greeting is filed under, which
	 * is not necessarily the address that sends it (see applyPendingOperations).
	 */
	account: Readable<`0x${string}` | undefined>;
	config: {
		maxMessages: number;
	};
}): ViewStateStore {
	const {onchainState, operations, account, config} = params;

	// Main store - derives from onchainState + operations
	const _mainStore = derived(
		[{subscribe: onchainState.subscribe}, operations, account],
		([$onchainState, $operations, $account]): ViewStateValue => {
			if ($onchainState.step === 'Unloaded') {
				return {step: 'Unloaded'};
			}

			return {
				step: 'Loaded',
				messages: applyPendingOperations({
					messages: $onchainState.messages,
					operations: $operations,
					account: $account,
					maxMessages: config.maxMessages,
				}),
			};
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
