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
			// The item as the store that delivered it last saw it, WITH that store:
			// on an account switch the lifecycle can fire before the new store's
			// item does, and a value kept without its store would then be shown as
			// the new account's (measured by review, 2026-10-28).
			let operation: OnchainOperation | undefined;
			let operationFrom: unknown;

			// Computed from synchronous sources (the current store and its own
			// state), using the delivered item only when it came from the current
			// store: `watchItem` and `lifecycle$` both fire on a state change, in
			// no guaranteed order, so whichever runs first must already see the
			// truth.
			// One emission per change of state; `found` always emits, since the
			// operation itself is what changes there.
			let last: InspectedOperation | undefined;
			const emit = (next: InspectedOperation) => {
				if (
					next.status !== 'found' &&
					last?.status === next.status &&
					last.key === next.key &&
					('error' in last ? last.error : undefined) ===
						('error' in next ? next.error : undefined)
				) {
					return;
				}
				last = next;
				set(next);
			};

			const update = () => {
				const store = accountData.get();
				if (operation && operationFrom === store) {
					foundFor = store?.account;
					emit({status: 'found', key, operation});
					return;
				}
				if (!store) {
					emit({status: 'no-account', key});
					return;
				}
				const current = store.get();
				if (current.status === 'error') {
					emit({status: 'unavailable', key, error: current.loadError});
					return;
				}
				if (current.status !== 'ready') {
					emit({status: 'loading', key});
					return;
				}
				// Loaded, and the store HAS the operation, but its item has not been
				// delivered yet (the lifecycle fired first on the same state change).
				// The delivery follows at once; saying `missing` meanwhile would be a
				// claim the store's own data contradicts.
				if (current.data.operations[key]) return;
				emit({
					status: foundFor === store.account ? 'cleared' : 'missing',
					key,
				});
			};

			// The item of EACH store in turn, subscribed on that store itself, so
			// every value is known to come from the store it is tagged with.
			let unsubscribeFromItem: (() => void) | undefined;
			let watching = false;
			const unsubscribeFromStore = accountData.subscribe((store) => {
				unsubscribeFromItem?.();
				unsubscribeFromItem = undefined;
				operation = undefined;
				operationFrom = store;
				if (store) {
					unsubscribeFromItem = store
						.watchItem('operations', key)
						.subscribe((next) => {
							operation = next;
							update();
						});
				} else {
					update();
				}
			});
			// A trigger only: a load, a failure or a retry changes the store's
			// state, which this re-reads.
			const unsubscribeFromLifecycle = accountData.lifecycle$.subscribe(() => {
				if (watching) update();
			});
			watching = true;
			unsubscribeFromOperation = () => {
				unsubscribeFromLifecycle();
				unsubscribeFromItem?.();
				unsubscribeFromStore();
			};
		});

		return () => {
			unsubscribeFromOperation?.();
			unsubscribeFromOverlay();
		};
	});
}
