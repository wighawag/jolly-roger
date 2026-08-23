import {derived, type Readable} from 'svelte/store';
import type {InFlightState} from '$lib/core/transaction/in-flight-store';

/**
 * What is being sent RIGHT NOW, for the banner beside the browser's unload
 * prompt.
 *
 * The gap this fills. `startInFlightTracking` arms an unload guard on
 * `dispatching > 0`, so the browser asks "leave site?" while a dispatch is
 * awaited. Meanwhile `in-flight-report.ts` deliberately shows nothing in that
 * window, on the reasoning that "the wallet, not us, is the thing the user is
 * waiting on". That is true for the wallet and false for the local signer,
 * which sends silently: nothing is on screen, the user never knew a transaction
 * existed, and the browser dialog arrives unexplained.
 *
 * An unexplained blocking dialog is worse than none. The user cannot tell
 * whether it is safe to leave, so they learn to dismiss it, which is exactly
 * the habit the guard depends on them not having.
 *
 * So this does not narrow the guard, it explains it. The prompt still fires,
 * and now something on the page says what for.
 */
export type SendingState = {
	/** Whether anything is mid-dispatch. Drives the banner's visibility. */
	sending: boolean;
	/** How many, so "1 transaction" does not lie when there are two. */
	count: number;
	/**
	 * What the oldest one is doing, in the words the transaction list uses, so a
	 * user comparing the two sees the same name. Undefined when a dispatch
	 * carried no description.
	 */
	description: string | undefined;
};

export function createSendingState(
	inFlight: Readable<InFlightState>,
): Readable<SendingState> {
	return derived(inFlight, ($inFlight): SendingState => {
		// `dispatching` counts what is ACTUALLY being awaited, which is what the
		// unload guard keys on. `requests` also holds records the app has stopped
		// awaiting but not yet reconciled, and those must not light this up: the
		// user is not being held for them and the guard does not fire for them.
		const count = $inFlight.dispatching;
		if (count <= 0) {
			return {sending: false, count: 0, description: undefined};
		}
		// Oldest first, matching the order they were dispatched in, so the one
		// named is the one that has been waiting longest.
		const awaiting = $inFlight.requests.filter(
			(request) => !$inFlight.outcomes[request.id],
		);
		return {
			sending: true,
			count,
			description: awaiting[0]?.intent.description,
		};
	});
}
