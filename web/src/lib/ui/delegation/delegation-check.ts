import {get, writable, type Readable} from 'svelte/store';
import {isRegistered, type DelegationStore} from '$lib/onchain/delegation';
import type {TopUpFlow} from '$lib/ui/credits/top-up-flow';
import type {
	ConfirmationRequest,
	ConfirmationStore,
} from '$lib/core/ui/confirm/confirmation';

/**
 * Getting past "this browser may not act for you yet", without losing what the
 * user was doing.
 *
 * THE POINT: an action that stops because of a missing authorisation should
 * come BACK once the authorisation is there. Opening the registration flow and
 * abandoning the send leaves the user to notice for themselves that they now
 * have to ask again, which reads as the app having forgotten. This mirrors what
 * `balanceCheck.ensureCanAfford` already does for a shortfall: the action waits
 * on a promise while the obstacle is dealt with, then resumes.
 *
 * It resumes on the user's say-so, not automatically. By the time registration
 * lands the user has been through a wallet, possibly a faucet and an account
 * switch, and firing a transaction at them with no warning would be the app
 * acting on an intention they expressed several minutes and several dialogs
 * ago. So the last step is a plain question with the action named in it.
 *
 * Whether the authorisation exists is read from the CHAIN, never from how the
 * flow ended. A flow can close for reasons that have nothing to do with the
 * registration, and the only thing that decides whether the next call will be
 * accepted is what the registry says.
 */

export type DelegationCheckState =
	| {step: 'idle'}
	/** The registration flow is on screen; it renders its own modal. */
	| {step: 'registering'};

/** The user backed out rather than completing the authorisation. */
export class NotRegisteredError extends Error {
	name = 'NotRegisteredError';
	constructor() {
		super('This browser is not authorised to act for the account');
	}
}

export type DelegationCheckStore = Readable<DelegationCheckState> & {
	/**
	 * Ensure this browser may act for the account, walking the user through
	 * getting there if it may not, and resolving only when the caller may
	 * proceed.
	 *
	 * Throws {@link NotRegisteredError} when the user backs out, which a call
	 * site treats exactly as it treats a dismissed funds modal: a cancellation,
	 * not a failure, because the user was shown what was needed and said no.
	 */
	ensureRegistered(params: {
		signer: `0x${string}` | undefined;
		/**
		 * What the caller was doing, for the question asked once this is settled.
		 *
		 * The CALLER's half of it: what to call the action and what to show back.
		 * This module supplies the other half (what changed and why), because that
		 * is the part it knows. See core/ui/resume.
		 */
		resume: {
			/** What to call it, as the button that performs it. */
			action: string;
			/** What it will do, shown back to them (the greeting itself). */
			detail?: string;
		};
	}): Promise<void>;
	close(): void;
};

/**
 * What this gate contributes to the question at the end.
 *
 * Deliberately says "act in your name" rather than naming any particular
 * action: what the delegate will be used FOR belongs to the app, and arrives
 * as the caller's half of the request.
 */
const RESUME_TITLE = 'This browser can now act for you';
const RESUME_EXPLANATION =
	'Your account has authorised this browser, so it can act in your name without asking you to sign each time.';

/**
 * Resolve once a flow that is currently open has closed.
 *
 * Watches the flow rather than being told by it, so the flow does not have to
 * know it is being waited on and every way out of it (finished, cancelled,
 * escape key, a step that failed) ends the wait.
 */
function whenClosed(flow: Readable<{open: boolean}>): Promise<void> {
	return new Promise((resolve) => {
		let sawOpen = false;
		let done = false;
		let unsubscribe: (() => void) | undefined;

		unsubscribe = flow.subscribe((state) => {
			if (done) return;
			if (state.open) {
				sawOpen = true;
				return;
			}
			// Only after it has actually been open: svelte calls this immediately
			// with the current value, and a flow that has not rendered yet is
			// indistinguishable from one that has closed.
			if (sawOpen) {
				done = true;
				// Not assigned yet when this fires on that first synchronous call,
				// which the line after the subscription handles.
				unsubscribe?.();
				resolve();
			}
		});

		if (done) unsubscribe();
	});
}

export function createDelegationCheckStore(params: {
	delegation: DelegationStore;
	topUp: TopUpFlow;
	/** Where the "carry on?" question is asked; see core/ui/confirm. */
	confirmation: ConfirmationStore;
}): DelegationCheckStore {
	const {delegation, topUp, confirmation} = params;
	const store = writable<DelegationCheckState>({step: 'idle'});

	const close = () => store.set({step: 'idle'});

	return {
		subscribe: store.subscribe,
		close,

		async ensureRegistered({signer, resume: request}) {
			if (!signer) throw new NotRegisteredError();

			if (isRegistered(get(delegation))) return;

			// One direct read before troubling the user: the poll may simply not
			// have caught up with a registration that just landed, and sending them
			// through a flow with nothing left to do would be worse than the wait.
			if (isRegistered(await delegation.update())) return;

			// The registration flow funds the signer in the same transaction, so
			// this is also how an empty signer gets its gas. It renders its own
			// modal; this step only records that we are waiting on it.
			store.set({step: 'registering'});
			void topUp.start();
			await whenClosed(topUp);

			// The CHAIN decides, not the flow: it can close for reasons that say
			// nothing about whether the registration landed.
			if (!isRegistered(await delegation.update())) {
				close();
				throw new NotRegisteredError();
			}

			// Both halves of the question: what changed (this gate's words) and what
			// to carry on with (the caller's).
			close();
			const carryOn = await confirmation.ask({
				title: RESUME_TITLE,
				explanation: RESUME_EXPLANATION,
				detail: request.detail,
				confirmLabel: request.action,
			} satisfies ConfirmationRequest);
			// Declining is an answer, and this gate's callers already treat it the
			// way they treat a dismissed funds modal: a cancellation, not a failure.
			if (!carryOn) throw new NotRegisteredError();
		},
	};
}
