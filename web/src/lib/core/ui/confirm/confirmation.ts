import {writable, type Readable} from 'svelte/store';

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
 * - "your wallet may still have this request, really stop waiting?" when the
 *   user gives up on something the app has already handed to a wallet.
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
};

export function createConfirmation(): ConfirmationStore {
	const store = writable<ConfirmationState>({step: 'idle'});

	/** Resolver for the question currently on screen, if any. */
	let answer: ((confirmed: boolean) => void) | undefined;

	const settle = (confirmed: boolean) => {
		const respond = answer;
		answer = undefined;
		store.set({step: 'idle'});
		respond?.(confirmed);
	};

	return {
		subscribe: store.subscribe,

		withdraw() {
			if (answer) settle(false);
		},

		ask(request) {
			// Whatever was being asked is no longer the question.
			if (answer) settle(false);

			return new Promise<boolean>((resolve) => {
				answer = resolve;
				store.set({
					...request,
					step: 'asking',
					onConfirm: () => settle(true),
					onCancel: () => settle(false),
				});
			});
		},
	};
}
