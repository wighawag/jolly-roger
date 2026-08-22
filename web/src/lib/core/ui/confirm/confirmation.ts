import {derived, get, type Readable} from 'svelte/store';
import {definePromptOverlay, type OverlayRegistry} from '$lib/core/ui/overlay';

/**
 * A yes/no question the app has to ask before it goes on.
 *
 * ONE mechanism, because the app keeps needing the same thing in different
 * moments, and each one hand-rolling a modal is how they drift apart:
 *
 * - "you were doing X, carry on?" after something that blocked it was dealt
 *   with. Dropping the action there is what makes an app feel forgetful, and
 *   firing it automatically is the app acting on an intention expressed several
 *   dialogs ago;
 * - "you are about to give up on a run the wallet may still act on, are you
 *   sure?" when the user cancels the top-up flow mid-send.
 *
 * NOT the escape hatch from a wallet that will not answer, which is a related
 * question this once claimed as its motivating example. That one shipped
 * WITHOUT `ask()`: it is a prompt overlay plus a `BasicModal` whose words come
 * from `escapeHatchCopy` in `core/connection/wallet-activity.ts`, and it lives
 * there because it is a question about the connection flow. Routing it through
 * here would move a feature that belongs to every app built on this template
 * into a mechanism only some of them have.
 *
 * Everything is DATA: who asks supplies the words, this holds the promise, and
 * one modal renders whatever is pending. An app wanting different presentation
 * subscribes to the same store and renders its own, without touching a caller.
 *
 * A QUESTION CAN STOP MATTERING BEFORE IT IS ANSWERED, which is why
 * {@link ConfirmationStore.withdraw} exists. The worked case: the user presses
 * Cancel while a wallet request is open, is asked whether they are sure, and
 * the wallet answers while they are still reading. The question is now about
 * nothing, so the asker takes it back rather than leaving a dialog that will
 * act on a situation that has moved on.
 *
 * IT IS A PROMPT OVERLAY (ADR-0004, `work` branch), not a mechanism of its own.
 * That is what buys it the back gesture and dismissal-on-navigation for free,
 * and it is why there is no `set` anywhere below: the registry owns the open
 * state, and `onClose` is what settles the promise, so every way the question
 * can go away (the buttons, ESC, a click outside, back, a route change, the
 * context being torn down) resolves the caller exactly once. A second
 * mechanism running beside the registry would be a second close path, which is
 * the one thing the model does not allow.
 */
export type ConfirmationRequest = {
	/** Headline: what this is about. */
	title: string;
	/** The substance, in a player's terms. */
	explanation: string;
	/**
	 * Something to show back to the user rather than describe: the greeting they
	 * typed, the item they were buying. Rendered verbatim.
	 */
	detail?: string;
	/**
	 * The affirmative button, phrased as the thing it does ("Send your
	 * greeting", "Stop waiting"), never "OK". A label that names the action is
	 * the difference between answering and guessing.
	 */
	confirmLabel: string;
	/** The negative button. Defaults to "Not now". */
	cancelLabel?: string;
	/** Whether saying yes is the destructive choice, for the UI to reflect. */
	destructive?: boolean;
};

export type ConfirmationState =
	| {step: 'idle'}
	| ({
			step: 'asking';
			onConfirm: () => void;
			onCancel: () => void;
	  } & ConfirmationRequest);

export type ConfirmationStore = Readable<ConfirmationState> & {
	/**
	 * Ask, and resolve with the answer.
	 *
	 * A boolean rather than a throw, because declining is an ANSWER and what it
	 * means belongs to the caller: a gate turns it into its own "the user backed
	 * out" error, while another call site simply stops.
	 *
	 * ONE AT A TIME. A second question replaces the first, resolving it `false`,
	 * because two of these on screen at once is a bug in the caller rather than
	 * a state worth supporting: whichever answer arrived would be ambiguous.
	 */
	ask(request: ConfirmationRequest): Promise<boolean>;
	/** Take the question back; it resolves `false`. See the note above. */
	withdraw(): void;
	/**
	 * Announce that something renders this question. See
	 * `ViewOverlay.registerRenderer`: asking with nobody rendering would
	 * otherwise be a promise that never settles and no dialog to explain why.
	 */
	registerRenderer(): () => void;
};

/**
 * The question on screen: what to show, and how to answer it.
 *
 * The resolver travels IN THE PAYLOAD rather than in a variable beside the
 * store, because the definition's `onClose` is handed the payload and nothing
 * else. That is what lets one module-level definition settle whichever question
 * happens to be open, however it goes away.
 */
type PendingQuestion = {
	request: ConfirmationRequest;
	/** Resolves the `ask()` promise. Idempotent: only the first call counts. */
	settle: (confirmed: boolean) => void;
};

/**
 * A PROMPT overlay: never in the URL, never restored after a reload.
 *
 * Restoring a confirmation would restore a question about an action whose
 * in-memory context is gone (the run it was cancelling, the greeting it was
 * resuming), and the URL is shareable, which would turn "really give up?" into
 * a link. See ADR-0004 (`work` branch).
 */
export const confirmationPrompt = definePromptOverlay<PendingQuestion>(
	'confirmation',
	{
		// THE HOOK THIS WHOLE SHAPE RESTS ON. Whatever closes the dialog resolves
		// the caller, so a navigation or a back gesture cannot leave an `await`
		// hanging for the life of the tab.
		onClose: (pending) => pending.settle(false),
	},
);

export function createConfirmation(
	overlays: OverlayRegistry,
): ConfirmationStore {
	const overlay = overlays.use(confirmationPrompt);

	const store = derived(overlay, ($overlay): ConfirmationState => {
		if (!$overlay.open) return {step: 'idle'};
		const pending = $overlay.payload;
		return {
			...pending.request,
			step: 'asking',
			// Answer first, then close. `close()` runs `onClose`, which settles
			// `false`; settling is idempotent, so the answer already given wins and
			// the confirm path needs no special case in the registry.
			onConfirm: () => {
				pending.settle(true);
				overlay.close();
			},
			// No `settle(false)` here: closing does it, which is the same route ESC,
			// a click outside and the back gesture take.
			onCancel: () => overlay.close(),
		};
	});

	return {
		subscribe: store.subscribe,

		withdraw() {
			// Closing settles `false` through `onClose`. Closing an overlay that is
			// not open is a no-op, so withdrawing a question nobody asked is safe.
			overlay.close();
		},

		ask(request) {
			return new Promise<boolean>((resolve) => {
				let settled = false;
				const settle = (confirmed: boolean) => {
					if (settled) return;
					settled = true;
					resolve(confirmed);
				};

				// ONE AT A TIME. A second question replaces the first, which resolves
				// `false`. Read live rather than closed-then-reopened: `open()` on an
				// overlay that is already open RETARGETS it, keeping the single history
				// entry the model gives each open overlay, where a close/open pair would
				// drop one entry and push another for what the user sees as one dialog
				// changing its words.
				const current = get(overlay);
				if (current.open) current.payload.settle(false);

				overlay.open({request, settle});
			});
		},

		registerRenderer: () => overlay.registerRenderer(),
	};
}
