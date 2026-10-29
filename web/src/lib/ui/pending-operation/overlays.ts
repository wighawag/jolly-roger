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
 * Not "the operation or nothing", and the distinction that matters is `loading`
 * versus `missing`. Account data is restored asynchronously (a localStorage
 * adapter, and only once an account is known), so an item that is not there yet
 * is UNKNOWN rather than gone. Collapsing the two meant that reloading an
 * addressed operation, or landing on a link to one, closed the inspector during
 * the gap and stripped the id back out of the URL.
 *
 * `unavailable` is the third answer to "is it there": the account's data FAILED
 * to load, so whether the operation exists cannot be known. It is not `loading`
 * (that never ends) and not `missing` (that claims we looked). `no-account` is
 * the fourth: nobody is connected, so there is no list to look in, which a link
 * opened before connecting would otherwise show as a load that never ends.
 */
export type InspectedOperation =
	| {status: 'closed'; key?: undefined}
	| {status: 'loading'; key: string}
	/** No account is connected, so there is no list to look in. */
	| {status: 'no-account'; key: string}
	/** The account data could not be loaded; `error` is the load's. */
	| {status: 'unavailable'; key: string; error: Error}
	/** Never seen: a stale or mistyped link. */
	| {status: 'missing'; key: string}
	/**
	 * Seen, then removed while the inspector was open, from the SAME account's
	 * list (a switch or a disconnect is not a removal).
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
			// WHOSE list the operation was last seen in, which is what separates "it
			// finished and was cleared" from "we never had it" AND from "this is
			// another account's list now": a switch or a disconnect empties the
			// list without anything having finished.
			let foundFor: `0x${string}` | undefined;
			let operation: OnchainOperation | undefined;

			// Computed from SYNCHRONOUS sources (the current store and its own
			// state), never from the last value a listener delivered: `watchItem`
			// and `lifecycle$` both fire on a state change, in no guaranteed order,
			// so whichever runs first must already see the truth.
			const update = () => {
				const store = accountData.get();
				if (operation) {
					foundFor = store?.account;
					set({status: 'found', key, operation});
					return;
				}
				if (!store) {
					set({status: 'no-account', key});
					return;
				}
				const current = store.get();
				if (current.status === 'error') {
					set({status: 'unavailable', key, error: current.loadError});
					return;
				}
				if (current.status !== 'ready') {
					set({status: 'loading', key});
					return;
				}
				set({
					status: foundFor === store.account ? 'cleared' : 'missing',
					key,
				});
			};

			// A trigger only: a disconnect changes no item (the list was already
			// empty for this key), so without it the inspector would not notice.
			let watching = false;
			const unsubscribeFromLifecycle = accountData.lifecycle$.subscribe(() => {
				if (watching) update();
			});
			const unsubscribeFromItem = accountData
				.watchItem('operations', key)
				.subscribe((next) => {
					operation = next;
					update();
				});
			watching = true;
			unsubscribeFromOperation = () => {
				unsubscribeFromItem();
				unsubscribeFromLifecycle();
			};
		});

		return () => {
			unsubscribeFromOperation?.();
			unsubscribeFromOverlay();
		};
	});
}
