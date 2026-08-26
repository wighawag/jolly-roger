import {derived, readable, type Readable} from 'svelte/store';
import type {InFlightState} from '$lib/core/transaction/in-flight-store';

/**
 * What is being sent RIGHT NOW, for the indicator beside the browser's unload
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
 *
 * TWO SURFACES, ONE FACT, and the split is what makes this bearable to look at.
 *
 * A `beforeunload` dialog is modal to the page: the renderer is blocked while it
 * is up, so timers do not fire and no frame is painted. Whatever explains the
 * dialog therefore has to be on screen ALREADY when it appears; anything
 * scheduled for later is never painted, and neither is a DOM change made inside
 * the handler, since painting needs the handler to return first.
 *
 * That forces something immediate. It does NOT force that something to be a
 * sentence, which is what the first version of this got wrong: a full-width bar
 * in flow, carrying two lines of explanation, appearing and vanishing inside
 * one blink on every local-signer send. A UI that shouts on every routine
 * action is how a user learns to ignore it, which is the same habit the guard
 * depends on them not having.
 *
 * So the fact is reported at two volumes:
 *
 * - {@link createSendingPulse}, immediate and wordless, on the account button in
 *   the navbar. It costs no layout and says the one thing the silent-signer user
 *   was missing: something is happening with your account right now. This is the
 *   rung that is up whenever the guard is armed, which is why the navbar renders
 *   it OUTSIDE the connected/disconnected branch: a connection that downgrades
 *   mid-dispatch (a wallet locking rebuilds its state, see the sources listed in
 *   `core/connection/wallet-activity.ts`) must not take the only mark on screen
 *   with it.
 * - {@link createSendingNotice}, the floating pill, which waits
 *   {@link NOTICE_AFTER_MS} before saying anything. A dispatch that outlives
 *   that is the wallet thinking, a slow RPC or a node that is gone, which is
 *   exactly when the user has time to reach for reload and needs words rather
 *   than a hint.
 *
 * THE CONCESSION, recorded rather than glossed, in all three of its parts.
 *
 * A reload inside the first {@link NOTICE_AFTER_MS} gets the dialog explained by
 * a pulsing badge and nothing else. That is a weaker promise than the sentence,
 * and it is the price of not crying wolf on every move.
 *
 * FOR A SCREEN READER IT IS NOT WEAKER, IT IS NOTHING. The pulse is
 * `aria-hidden` (announcing a 300ms event on every move is noise), and the
 * notice is the only `role="status"` surface, so a dispatch that never reaches
 * the delay is never announced. Assistive tech learns about it afterwards, from
 * the pending-operations badge and the transaction list, the same way it learns
 * about a transaction that was sent from another tab.
 *
 * AND A BURST IS NEVER EXPLAINED. {@link delayVisible} measures one
 * uninterrupted run, so ten 300ms dispatches in a row never reach the threshold
 * however long the burst lasts in total. That is deliberate rather than
 * overlooked: the guard disarms between them too, so each prompt the user could
 * meet is a prompt for a dispatch that has been alive for milliseconds, which is
 * exactly the case the delay judges not worth words. If that ever stops being
 * true, the fix is to measure activity rather than a single run, not to shorten
 * the delay.
 *
 * The pill FLOATS rather than sitting in flow because it is transient action
 * feedback. The bars at the top of the layout (offline, RPC health, nonce cache)
 * report DURABLE conditions, and that is what earns the right to displace
 * content and make the page shorter.
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

/**
 * Where the app puts the indicator, chosen at the composition root.
 *
 * A knob rather than a fixed answer because the template cannot know what its
 * descendants already show. An app whose own UI says "Sending commitment..."
 * next to the button the user just pressed has ALREADY explained the prompt,
 * better than a generic bar can, and a second announcement of the same fact is
 * noise. `'banner'` keeps the original in-flow bar for apps that want the page
 * to make room for it.
 *
 * WHAT THIS DOES NOT REACH: only the WORDS. The wordless rung
 * ({@link createSendingPulse}, on the navbar's account button) is not gated by
 * this, because it costs no layout, says nothing an app could contradict, and is
 * the rung that is up whenever the unload guard is armed. `'none'` therefore
 * means "my app explains its own sends, keep the template quiet", not "show
 * nothing".
 *
 * And it does not disable the unload guard either, which is armed from domain
 * state in `core/transaction/in-flight-tracking.ts` and knows nothing about
 * this. The browser will still ask.
 */
export type SendingIndicatorPlacement = 'floating' | 'banner' | 'none';

/**
 * Which mount point a placement needs: in the document flow with the other
 * bars, or in an overlay layer above them.
 */
export type SendingIndicatorSlot = 'flow' | 'overlay';

/**
 * The placement-to-mount-point mapping, in ONE place and exhaustive.
 *
 * The layout has to decide WHERE to render, and it did so with two independent
 * string comparisons. Adding a member to {@link SendingIndicatorPlacement} then
 * compiled cleanly, matched neither comparison, and rendered nowhere: a knob
 * that silently does nothing, which is the worst outcome for something whose
 * whole purpose is to be flipped by descendants. The `never` assignment below
 * turns that into a type error at the one place that knows the answer.
 */
export function sendingIndicatorSlot(
	placement: SendingIndicatorPlacement,
): SendingIndicatorSlot | undefined {
	switch (placement) {
		case 'banner':
			return 'flow';
		case 'floating':
			return 'overlay';
		case 'none':
			return undefined;
		default: {
			const unhandled: never = placement;
			return unhandled;
		}
	}
}

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

/**
 * How long a dispatch stays on screen once it has appeared, even if it is
 * already over.
 *
 * Long enough to read as an appearance rather than a flicker, short enough that
 * it is gone before it can be mistaken for a stuck request. Not a correctness
 * value: nothing depends on the number, and the guard is unaffected either way.
 */
export const MIN_VISIBLE_MS = 800;

/** Nothing in flight, said once so the two rules below cannot word it differently. */
const DARK: SendingState = {sending: false, count: 0, description: undefined};

/**
 * IMMEDIATE ON, LAZY OFF: light up the moment a dispatch starts, and stay lit
 * for at least {@link MIN_VISIBLE_MS} once lit.
 *
 * THE ASYMMETRY IS THE POINT, and each half answers a different problem.
 *
 * On, immediately, because the indicator's job is to be on screen when the
 * browser's dialog arrives, and that dialog freezes the page (see the module
 * comment). Delaying the appearance to dodge the flicker would trade a visual
 * annoyance for an unexplained blocking dialog, which is the bug, not the fix.
 * Whatever is armed, the user can see.
 *
 * Off, lazily, because a local-signer dispatch resolves in a few hundred
 * milliseconds and something that appears and vanishes inside one blink reads
 * as a glitch in the page rather than as information about it.
 *
 * The last words are kept during the hold rather than blanked: the alternative
 * is an empty box fading out, and the text is a description of what was just
 * sent, which does not stop being true the instant the answer arrives.
 *
 * A new dispatch during the hold cancels it and restarts the clock, so two
 * quick sends read as one continuous "sending" rather than as a strobe.
 */
export function holdVisible(
	source: Readable<SendingState>,
	options: {minVisibleMs?: number} = {},
): Readable<SendingState> {
	const {minVisibleMs = MIN_VISIBLE_MS} = options;

	return readable<SendingState>(DARK, (set) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let shownAt: number | undefined;
		// Last thing published, so an unchanged source tick does not republish and
		// make every subscriber re-evaluate (the navbar rebuilds a class string on
		// each one). `derived` hands us a fresh object per ledger update, so
		// identity alone cannot answer this.
		let published: SendingState = DARK;

		function publish(next: SendingState) {
			if (
				next.sending === published.sending &&
				next.count === published.count &&
				next.description === published.description
			) {
				return;
			}
			published = next;
			set(next);
		}

		function clearTimer() {
			if (timer === undefined) return;
			clearTimeout(timer);
			timer = undefined;
		}

		const unsubscribe = source.subscribe(($sending) => {
			if ($sending.sending) {
				// Restarts the clock, so the hold measures the LAST thing shown rather
				// than the first, and passes through changes (a second dispatch raising
				// the count) with no delay of their own.
				clearTimer();
				shownAt = Date.now();
				publish($sending);
				return;
			}

			// Never shown: nothing to hold, and no reason to make the page wait
			// before agreeing that nothing is happening.
			if (shownAt === undefined) {
				publish(DARK);
				return;
			}

			const remaining = minVisibleMs - (Date.now() - shownAt);
			if (remaining <= 0) {
				shownAt = undefined;
				clearTimer();
				publish(DARK);
				return;
			}

			// Already counting down. A second empty update must not extend the hold,
			// or a store that re-emits would keep it up indefinitely.
			if (timer !== undefined) return;

			timer = setTimeout(() => {
				timer = undefined;
				shownAt = undefined;
				publish(DARK);
			}, remaining);
		});

		return () => {
			clearTimer();
			unsubscribe();
		};
	});
}

/**
 * How long a dispatch has to last before it is worth WORDS.
 *
 * Above a second is where a send stops feeling like the click landing and starts
 * feeling like waiting, and it is the earliest a user plausibly reaches for
 * reload. Below it, the pulse on the account button carries the fact instead.
 */
export const NOTICE_AFTER_MS = 1_200;

/**
 * Show only what has been true CONTINUOUSLY for `afterMs`.
 *
 * The mirror of {@link holdVisible}, and used with it rather than instead of it:
 * a dispatch that crosses the delay by a hair would otherwise appear and vanish,
 * which is the flicker moved rather than fixed.
 *
 * Anything that goes dark before the delay elapses never appears at all, and
 * that is the point: the common case (a local signer answering in a few hundred
 * milliseconds) paints no text, ever.
 */
export function delayVisible(
	source: Readable<SendingState>,
	options: {afterMs?: number} = {},
): Readable<SendingState> {
	const {afterMs = NOTICE_AFTER_MS} = options;

	return readable<SendingState>(DARK, (set) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let shown = false;
		// Kept so the moment the delay elapses can publish what is true THEN,
		// rather than the state that started the clock: a second dispatch may have
		// joined in the meantime, and the pill would open claiming one.
		let latest: SendingState = DARK;

		function clearTimer() {
			if (timer === undefined) return;
			clearTimeout(timer);
			timer = undefined;
		}

		const unsubscribe = source.subscribe(($sending) => {
			latest = $sending;

			if (!$sending.sending) {
				// The run is over, so the clock starts again from zero next time. A
				// pause between two dispatches is not progress toward the delay.
				clearTimer();
				if (shown) {
					shown = false;
					set(DARK);
				}
				return;
			}

			// Already through the delay: pass changes on with no delay of their own,
			// so the count is live once the pill is up.
			if (shown) {
				set($sending);
				return;
			}

			// Mid-countdown. Not restarted, because this is the SAME uninterrupted
			// run of activity, and restarting on every update would mean a busy
			// dispatch never crossed its own deadline.
			if (timer !== undefined) return;

			timer = setTimeout(() => {
				timer = undefined;
				shown = true;
				set(latest);
			}, afterMs);
		});

		return () => {
			clearTimer();
			unsubscribe();
		};
	});
}

/**
 * The wordless rung: what the account button pulses on.
 *
 * Immediate, because this is the one that has to be on screen when the browser
 * asks. Held, so a dispatch answered in 200ms reads as a pulse rather than a
 * glitch.
 */
export function createSendingPulse(
	inFlight: Readable<InFlightState>,
): Readable<SendingState> {
	return holdVisible(createSendingState(inFlight));
}

/**
 * The explanatory rung: what the floating pill says, once a dispatch has gone on
 * long enough to be worth explaining.
 *
 * Held as well as delayed, because crossing the threshold and being answered
 * immediately afterwards is a real sequence, and it must not flash either.
 */
export function createSendingNotice(
	inFlight: Readable<InFlightState>,
	options: {afterMs?: number; minVisibleMs?: number} = {},
): Readable<SendingState> {
	return holdVisible(
		delayVisible(createSendingState(inFlight), {afterMs: options.afterMs}),
		{minVisibleMs: options.minVisibleMs},
	);
}
