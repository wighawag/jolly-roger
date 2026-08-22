import {readable, type Readable} from 'svelte/store';
import {
	defineContentOverlay,
	definePromptOverlay,
	type OverlayState,
} from '$lib/core/ui/overlay';
import type {
	MultiAccountDataStore,
	OnchainOperation,
} from '$lib/account/AccountData';

/**
 * The operation inspector, and the three questions it can ask.
 *
 * The inspector is a CONTENT overlay: it shows a thing, so it is addressable
 * (`?operation=<id>`), survives a reload, and can be linked to. The three
 * dialogs are PROMPT overlays: each asks about an action in flight, so putting
 * one in the URL would mean restoring a question after a reload whose subject is
 * gone, and sharing a link that opens somebody else's app on "Confirm cancel".
 * See ADR-0004 (`work` branch).
 */
export const pendingOperationOverlay = defineContentOverlay(
	'pending-operation',
	{
		param: 'operation',
	},
);

export const dismissConfirmPrompt = definePromptOverlay(
	'pending-operation-dismiss-confirm',
);

export const resubmitPrompt = definePromptOverlay('pending-operation-resubmit');

export const cancelConfirmPrompt = definePromptOverlay(
	'pending-operation-cancel-confirm',
);

/**
 * What the inspector is currently about.
 *
 * FOUR states, not "the operation or nothing", and the distinction that matters
 * is `loading` versus `missing`. Account data is restored asynchronously (a
 * localStorage adapter, and only once an account is known), so an item that is
 * not there yet is UNKNOWN rather than gone. Collapsing the two meant that
 * reloading an addressed operation, or landing on a link to one, closed the
 * inspector during the gap and stripped the id back out of the URL.
 */
export type InspectedOperation =
	| {status: 'closed'; key?: undefined}
	| {status: 'loading'; key: string}
	/** Never seen: a stale or mistyped link. */
	| {status: 'missing'; key: string}
	/**
	 * Seen, then removed while the inspector was open.
	 *
	 * Account data drops an operation once it finalizes successfully
	 * (`AccountData.updateOperationFromTransactionStateUpdated`), so this is the
	 * normal end of a transaction being watched, not an error. Distinguished from
	 * `missing` because the two deserve different words: one says the transaction
	 * completed, the other that we never had it.
	 */
	| {status: 'cleared'; key: string}
	| {status: 'found'; key: string; operation: OnchainOperation};

/**
 * The operation the inspector is about, followed LIVE.
 *
 * The overlay carries a key, never a copy: before this, both openers passed a
 * snapshot of the operation, so a modal left open while its transaction was
 * included, finalized or resubmitted kept showing the state it had when it
 * opened. Addressing the operation instead of copying it is what makes the view
 * follow it.
 */
export function watchOverlayOperation(
	overlay: Readable<OverlayState<string>>,
	accountData: MultiAccountDataStore,
): Readable<InspectedOperation> {
	return readable<InspectedOperation>({status: 'closed'}, (set) => {
		let unsubscribeFromOperation: (() => void) | undefined;

		const unsubscribeFromOverlay = overlay.subscribe((state) => {
			unsubscribeFromOperation?.();
			unsubscribeFromOperation = undefined;

			if (!state.open) {
				set({status: 'closed'});
				return;
			}

			const key = state.payload;
			// Whether this operation was ever in hand, which is what separates "it
			// finished and was cleared" from "we never had it".
			let everFound = false;
			unsubscribeFromOperation = accountData
				.watchItem('operations', key)
				.subscribe((operation) => {
					if (operation) {
						everFound = true;
						set({status: 'found', key, operation});
						return;
					}
					if (everFound) {
						set({status: 'cleared', key});
						return;
					}
					// Re-read readiness on every emission rather than caching it:
					// `watchItem` also fires when the store's state changes, which is
					// exactly when "not ready" becomes "ready".
					set({status: accountData.isReady() ? 'missing' : 'loading', key});
				});
		});

		return () => {
			unsubscribeFromOperation?.();
			unsubscribeFromOverlay();
		};
	});
}
