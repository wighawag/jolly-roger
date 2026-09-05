import type {
	MultiAccountDataStore,
	OnchainOperation,
	Schema,
} from './AccountData';
import {toast} from 'svelte-sonner';
import type {TransactionIntentState} from '@etherkit/tx-observer';
import {subscribeToAccountDataMap} from '$lib/core/utils/data/account-data-subscription';
import {pendingOperationOverlay} from '$lib/ui/pending-operation';
import type {OverlayRegistry} from '$lib/core/ui/overlay';
import {createConnector} from './connector';

/**
 * Gets a human-readable name for an operation from its metadata
 */
function getOperationName(op: OnchainOperation): string {
	const metadata = op.metadata;
	if (metadata.type === 'functionCall') {
		return metadata.functionName;
	}
	if (metadata.type === 'unknown') {
		return metadata.name;
	}
	return 'Transaction';
}

/**
 * Gets the status type for an operation's observer state.
 *
 * Takes the STATE rather than a whole intent: a toast asks one question about
 * what the observer last said, and the observer's state is stored on the
 * operation, so projecting an intent to read one field off it would be
 * ceremony.
 */
function getStatusType(
	state: TransactionIntentState | undefined,
): 'pending' | 'success' | 'error' {
	if (!state || state.inclusion === 'InMemPool') {
		return 'pending';
	}

	if (state.inclusion === 'NotFound' || state.inclusion === 'Dropped') {
		return 'error';
	}

	if (state.inclusion === 'Included') {
		if (state.outcome === 'Success') {
			return 'success';
		} else {
			return 'error';
		}
	}

	return 'error';
}

/**
 * Gets a descriptive message for the current status
 */
function getStatusMessage(state: TransactionIntentState | undefined): string {
	if (!state || state.inclusion === 'InMemPool') {
		return 'Transaction pending...';
	}

	if (state.inclusion === 'NotFound') {
		return 'Transaction not found';
	}

	if (state.inclusion === 'Dropped') {
		return 'Transaction was dropped';
	}

	if (state.inclusion === 'Included') {
		if (state.outcome === 'Success') {
			return 'Transaction confirmed';
		} else {
			return 'Transaction failed';
		}
	}

	return 'Unknown status';
}

/**
 * Creates a connector that shows toast notifications for operations
 * being added and updated in the account data store.
 */
interface OperationToastState {
	toastId: string | number;
	status: 'pending' | 'success' | 'error';
	inclusion: string;
	final: boolean;
	version: number;
}

export function createToastConnector(params: {
	accountData: MultiAccountDataStore;
	overlays: OverlayRegistry;
}) {
	const {accountData, overlays} = params;

	const inspector = overlays.use(pendingOperationOverlay);

	const operationToastStates = new Map<string, OperationToastState>();

	/**
	 * Get the next version number for an operation, ensuring unique toast IDs
	 */
	function getNextVersion(key: string): number {
		const state = operationToastStates.get(key);
		return (state?.version ?? 0) + 1;
	}

	function deleteOperation(key: string) {
		const currentAccountData = accountData.get();
		if (currentAccountData) {
			currentAccountData.removeItem('operations', key);
		}
	}

	// Helper to open modal while keeping toast visible
	function openModalAndKeepToast(key: string, event: MouseEvent) {
		// Prevent default to stop sonner from dismissing the toast
		event.preventDefault();
		// The key, not a copy of the operation: the inspector follows it live.
		inspector.open(key);
	}

	function renderErrorToast(
		key: string,
		operation: OnchainOperation,
		toastId: string,
	) {
		const operationName = getOperationName(operation);
		const state = operation.state;
		const inclusion = state?.inclusion ?? 'Unknown';
		// A boolean now, not a block timestamp whose mere presence meant final.
		const isFinal = state?.final === true;
		const message = getStatusMessage(state);

		if (inclusion === 'Dropped' && isFinal) {
			toast.error(operationName, {
				description: message,
				id: toastId,
				duration: Infinity,
				action: {
					label: 'Dismiss',
					onClick: () => deleteOperation(key),
				},
			});
		} else {
			toast.error(operationName, {
				description: message,
				id: toastId,
				duration: Infinity,
				action: {
					label: 'Inspect',
					onClick: (event) => openModalAndKeepToast(key, event),
				},
			});
		}
	}

	function showToast(key: string, operation: OnchainOperation) {
		const operationName = getOperationName(operation);
		const state = operation.state;
		const statusType = getStatusType(state);
		const message = getStatusMessage(state);
		const currentInclusion = state?.inclusion ?? '';
		const currentFinal = state?.final === true;

		const existing = operationToastStates.get(key);

		// Skip if status AND inclusion AND final haven't changed
		// (prevents duplicate toasts but allows NotFound→Dropped transitions and Dropped non-final→final)
		if (
			existing?.status === statusType &&
			existing?.inclusion === currentInclusion &&
			existing?.final === currentFinal
		) {
			return;
		}

		// Get version to ensure unique toast IDs under rapid state changes
		const version = getNextVersion(key);

		// Create unique toast ID based on current state and version
		// Version ensures uniqueness even when status/inclusion cycle back to same values
		const toastId =
			statusType === 'error'
				? `${key}-v${version}-${currentInclusion}-${currentFinal ? 'final' : 'pending'}`
				: `${key}-v${version}-${statusType}`;

		// Dismiss previous toast if ID changed
		const previousToastId = existing?.toastId;
		if (previousToastId && previousToastId !== toastId) {
			toast.dismiss(previousToastId);
		}

		const toastState: OperationToastState = {
			toastId,
			status: statusType,
			inclusion: currentInclusion,
			final: currentFinal,
			version,
		};

		if (statusType === 'pending') {
			toast.loading(operationName, {
				description: message,
				id: toastId,
			});
			operationToastStates.set(key, toastState);
		} else if (statusType === 'success') {
			toast.success(operationName, {
				description: message,
				id: toastId,
			});
			operationToastStates.set(key, toastState);
		} else if (statusType === 'error') {
			renderErrorToast(key, operation, toastId);
			operationToastStates.set(key, toastState);
		} else {
			toast.warning(operationName, {
				description: message,
				id: toastId,
			});
			operationToastStates.set(key, toastState);
		}
	}

	function handleOperationRemoved(key: string) {
		const state = operationToastStates.get(key);
		if (state) {
			toast.dismiss(state.toastId);
		}
		operationToastStates.delete(key);
	}

	function clearAllToasts() {
		for (const state of operationToastStates.values()) {
			toast.dismiss(state.toastId);
		}
		operationToastStates.clear();
	}

	return createConnector(() => {
		const unsubscribe = subscribeToAccountDataMap<Schema, 'operations'>({
			accountData,
			mapKey: 'operations',
			handlers: {
				onAdded: (key, item) => {
					showToast(key, item);
				},
				onUpdated: (key, item) => {
					showToast(key, item);
				},
				onRemoved: (key) => {
					handleOperationRemoved(key);
				},
				onClear: () => {
					clearAllToasts();
				},
				onInitialData: (operations) => {
					for (const [key, operation] of Object.entries(operations)) {
						const statusType = getStatusType(operation.state);
						// Only show toasts for pending operations on initial load
						if (statusType !== 'success' && !operationToastStates.has(key)) {
							showToast(key, operation);
						}
					}
				},
			},
		});

		return () => {
			unsubscribe();
			clearAllToasts();
		};
	});
}
