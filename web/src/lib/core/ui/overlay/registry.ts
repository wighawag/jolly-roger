import {writable, type Writable} from 'svelte/store';
import {randomId} from '$lib/core/utils/web/random-id';
import type {NavigationService} from '$lib/core/navigation';
import type {
	ContentOverlayDefinition,
	OverlayState,
	PayloadOf,
	ViewOverlay,
	ViewOverlayDefinition,
} from './define';

/**
 * The view-overlay registry (ADR-0004, `work` branch).
 *
 * Owns three things no feature should have to think about again: closing on a
 * route change, one history entry per open overlay so the back gesture unwinds
 * the stack, and giving those entries back safely.
 *
 * It owns STATE ONLY. Components keep declaring their own `Modal.Root` markup;
 * nothing here renders, and definitions carry no component reference, which is
 * what keeps this layer free of the framework.
 */

/** One of our history entries, innermost last. */
type StackEntry = {
	label: string;
	/** `undefined` when we adopted an entry we did not push (a deep link). */
	token: string | undefined;
};

type Instance = {
	definition: ViewOverlayDefinition<unknown>;
	store: Writable<OverlayState<unknown>>;
	state: OverlayState<unknown>;
	renderers: number;
};

export type OverlayRegistry = {
	use<Definition extends ViewOverlayDefinition<never>>(
		definition: Definition,
	): ViewOverlay<PayloadOf<Definition>>;
	/** Labels of every open overlay, innermost last. Debug/introspection. */
	openLabels(): string[];
	/** Stop following navigation (context teardown). */
	stop(): void;
};

export function createOverlayRegistry(
	navigation: NavigationService,
): OverlayRegistry {
	const instances = new Map<string, Instance>();
	let stack: StackEntry[] = [];
	/** Pathname we believe we are on, to tell a route change from a shallow push. */
	let pathname: string | undefined;

	function instanceOf(label: string): Instance | undefined {
		return instances.get(label);
	}

	function setState(instance: Instance, state: OverlayState<unknown>) {
		instance.state = state;
		instance.store.set(state);
	}

	/**
	 * Close ONE instance in memory, running its `onClose`.
	 *
	 * The single close path, because `onClose` is a promise-shaped asker's only
	 * chance to settle (`confirm(): Promise<boolean>` resolving `false`), and
	 * `define.ts` promises it runs whatever the cause. Anything that sets an
	 * instance closed by hand quietly breaks that promise, which is how teardown
	 * used to leave such a caller waiting forever.
	 */
	function closeInstance(instance: Instance) {
		if (!instance.state.open) return;
		const payload = instance.state.payload;
		setState(instance, {open: false});
		const definition = instance.definition;
		if (definition.kind === 'prompt') {
			definition.onClose?.(payload);
		}
	}

	/**
	 * Close in memory, innermost first, without touching history.
	 *
	 * Used both by `close()` (which has already dealt with the entries) and by
	 * the navigation listener (where the entries are gone or superseded), so it
	 * must never call back into the driver.
	 */
	function closeFrom(index: number) {
		const closing = stack.slice(index);
		stack = stack.slice(0, index);

		for (const entry of closing.reverse()) {
			const instance = instanceOf(entry.label);
			if (instance) closeInstance(instance);
		}
	}

	/**
	 * Content overlays follow the URL: the param IS the open state.
	 *
	 * TWO PASSES, deliberately. Closing one overlay cascades to anything stacked
	 * above it, which can close another content overlay whose param is still in
	 * the URL. Interleaved, whether that overlay was then re-adopted (and onto
	 * which entry) depended on `instances` insertion order, i.e. on the order
	 * features happened to call `use()`. Closing everything that should close
	 * before opening anything that should open makes the result the same however
	 * the map is ordered.
	 */
	function syncContentOverlays(url: URL, token: string | undefined) {
		const contentInstances = [...instances.values()].filter(
			(instance) => instance.definition.kind === 'content',
		);

		for (const instance of contentInstances) {
			const definition = instance.definition as ContentOverlayDefinition;
			if (url.searchParams.get(definition.param) !== null) continue;
			if (!instance.state.open) continue;

			const index = stack.findIndex((e) => e.label === definition.label);
			if (index >= 0) closeFrom(index);
			else closeInstance(instance);
		}

		for (const instance of contentInstances) {
			const definition = instance.definition as ContentOverlayDefinition;
			const value = url.searchParams.get(definition.param);
			if (value === null) continue;

			if (!instance.state.open) {
				// Adopt whatever entry we arrived on. It is ours when we pushed it
				// (back into an overlay we opened), and not ours on a deep link or a
				// reload, in which case `close()` rewrites the URL instead of popping.
				stack = [...stack, {label: definition.label, token}];
				setState(instance, {open: true, payload: value});
			} else if (instance.state.payload !== value) {
				setState(instance, {open: true, payload: value});
			}
		}
	}

	const unsubscribe = navigation.subscribe((location) => {
		if (!location) return;

		// A belt-and-braces check. A page change normally arrives on a fresh entry
		// carrying no token of ours, which the token check below already reads as
		// "everything we opened is behind us"; this also catches a navigation that
		// somehow kept our state, where the token alone would say to keep an overlay
		// open on a page it does not belong to.
		const routeChanged =
			pathname !== undefined && pathname !== location.url.pathname;
		pathname = location.url.pathname;

		if (routeChanged) {
			// A real page change. Every view overlay belongs to the page it was
			// opened from, so all of them go, and the entries they pushed stay
			// where they are: they are below the entry the router just created,
			// and popping them from under the user is not ours to do.
			closeFrom(0);
			syncContentOverlays(location.url, location.token);
			return;
		}

		// Same page: the current entry tells us how much of our stack survives.
		// Everything above the entry we are now on has been traversed away from.
		if (location.token === undefined) {
			// We are on an entry nobody claimed, so every overlay that PUSHED one is
			// behind us and closes. Adopted entries (a deep link, a reload) carry no
			// token by design and are not evidence of anything: closing them here
			// would close and immediately reopen the overlay on every notification,
			// which subscribers see as a flicker and which would also drop a prompt
			// stacked above a deep-linked overlay. Their fate is decided by the URL,
			// just below.
			const firstClaimed = stack.findIndex(
				(entry) => entry.token !== undefined,
			);
			closeFrom(firstClaimed >= 0 ? firstClaimed : stack.length);
		} else {
			const index = stack.findIndex((entry) => entry.token === location.token);
			closeFrom(index >= 0 ? index + 1 : 0);
		}

		syncContentOverlays(location.url, location.token);
	});

	function create(definition: ViewOverlayDefinition<unknown>): Instance {
		const store = writable<OverlayState<unknown>>({open: false});
		const instance: Instance = {
			definition,
			store,
			state: {open: false},
			renderers: 0,
		};
		instances.set(definition.label, instance);

		// A content overlay may already be in the URL when it is first used
		// (deep link, reload, or a page that mounts it late).
		const location = navigation.current();
		if (location) syncContentOverlays(location.url, location.token);

		return instance;
	}

	// Dev/debug: the same console-access affordance the app context has. What an
	// overlay bug looks like is almost always a disagreement between three things
	// (the stack, an instance's state, and whether anything renders it), and
	// reading them from the console is faster than any amount of guessing.
	let debugHandle: unknown;
	if (import.meta.env.DEV && typeof window !== 'undefined') {
		debugHandle = {
			stack: () => stack.map((entry) => ({...entry})),
			states: () =>
				Object.fromEntries(
					[...instances].map(([label, instance]) => [label, instance.state]),
				),
			renderers: () =>
				Object.fromEntries(
					[...instances].map(([label, instance]) => [
						label,
						instance.renderers,
					]),
				),
		};
		(globalThis as any).overlays = debugHandle;
	}

	return {
		use(definition) {
			const label = definition.label;
			const existing = instanceOf(label);

			if (
				import.meta.env.DEV &&
				existing &&
				existing.definition !== definition
			) {
				// The label IS the identity here, so a second definition under the same
				// one is silently ignored and the newcomer quietly shares another
				// feature's state, kind and param. Same collision the capability
				// registry warns about (core/capabilities/define.ts).
				console.warn(
					`[overlay] two different definitions share the label "${label}". ` +
						`The first one wins, so the second will read and write state that ` +
						`does not belong to it. Give one of them another label.`,
				);
			}

			const instance =
				existing ?? create(definition as ViewOverlayDefinition<unknown>);

			const overlay: ViewOverlay<any> = {
				subscribe: instance.store.subscribe,

				open(payload) {
					if (import.meta.env.DEV && instance.renderers === 0) {
						console.warn(
							`[overlay] opening "${label}" but nothing renders it. ` +
								`The component showing this overlay must call registerRenderer() ` +
								`(usually $effect(() => overlay.registerRenderer())).`,
						);
					}

					const definition = instance.definition;

					if (instance.state.open) {
						// Retarget: rewrite our entry rather than stack a second one for
						// the same overlay. One entry per open overlay is the invariant
						// the whole close path relies on; a second entry would strand the
						// first with a token nothing can give back.
						const entry = stack.find((e) => e.label === label);
						if (definition.kind === 'content') {
							const url = navigation.urlWithParam(definition.param, payload);
							if (url && entry?.token !== undefined) {
								navigation.replaceEphemeral(entry.token, url);
							} else if (url) {
								// Adopted entry: still ours to re-address, never ours to
								// claim. Without this the URL kept pointing at the previous
								// payload, so a reload showed the wrong thing and the next
								// location notification reverted the state to match it.
								navigation.replaceLocation(url);
							}
						}
						setState(instance, {open: true, payload});
						return;
					}

					const token = randomId();

					// BOOKKEEPING FIRST, then history. Pushing an entry makes the service
					// report the new location synchronously, and the listener below runs
					// against whatever the stack says at that instant: with the order
					// reversed it saw a token it did not know, read that as the user
					// having traversed away, and closed every overlay already open.
					//
					// While navigation is inert (the server, and the browser before
					// hydration finishes) the overlay opens with a token that no history
					// entry backs, and the first location reported after the driver
					// attaches will close it again. Nothing opens an overlay in that
					// window today; if something ever does, that is the behaviour to
					// expect, and the URL is the only thing that survives it.
					stack = [...stack, {label, token}];
					setState(instance, {open: true, payload});

					if (definition.kind === 'content') {
						const url = navigation.urlWithParam(definition.param, payload);
						navigation.pushEphemeral(token, url);
					} else {
						navigation.pushEphemeral(token);
					}
				},

				close() {
					const index = stack.findIndex((entry) => entry.label === label);
					if (index < 0) {
						closeInstance(instance);
						return;
					}

					const closing = stack.slice(index);
					const top = closing[closing.length - 1];

					// Every content overlay in the range has to leave the URL even when
					// we cannot pop, or a reload would bring it straight back. Chained,
					// not recomputed from the current URL each time: with two content
					// overlays closing together, recomputing kept only the last param
					// removal and silently restored the others.
					let fallbackUrl: URL | undefined;
					for (const entry of closing) {
						const definition = instanceOf(entry.label)?.definition;
						if (definition?.kind !== 'content') continue;
						const base = fallbackUrl ?? navigation.current()?.url;
						if (!base) continue;
						const next = new URL(base);
						next.searchParams.delete(definition.param);
						fallbackUrl = next;
					}

					// Closed in memory before history is touched, for the same reason the
					// open path records first: rewriting the URL reports a location change
					// synchronously, and the listener should meet a state that already
					// agrees with it.
					closeFrom(index);

					// GIVE BACK EXACTLY WHAT WE TOOK.
					//
					// Two kinds of entry live in this range. One we PUSHED, and owe back.
					// One we ADOPTED, the entry the user arrived on (a deep link, a
					// reload), which cost no history entry and is not ours to traverse
					// away from. Counting the range instead of our own entries popped one
					// too many, which in a real browser walks out of the app entirely:
					// reload with the inspector open, raise a prompt, let the action
					// succeed, and the app closes the whole page.
					//
					// Distinct tokens, not entries: an overlay re-adopted onto an entry we
					// already own shares that entry rather than adding one.
					const ourEntries = new Set(
						closing
							.map((entry) => entry.token)
							.filter((token): token is string => token !== undefined),
					);
					const bottomWasAdopted = closing[0]?.token === undefined;

					if (!bottomWasAdopted && top?.token !== undefined) {
						navigation.dropEphemeral(top.token, {
							count: ourEntries.size,
							fallbackUrl,
						});
					} else if (fallbackUrl) {
						// The bottom of the range is the entry the user arrived on, so
						// there is nothing beneath it that we may return to: traversing
						// would land back ON it, still addressing the overlay we just
						// closed, and reopen it. Rewrite where we stand instead. Entries we
						// pushed above it stay, which is the same bargain as navigating
						// away with an overlay open: back returns to how you arrived, with
						// the overlay addressed again.
						navigation.replaceLocation(fallbackUrl);
					}
				},

				registerRenderer() {
					instance.renderers++;
					return () => {
						instance.renderers--;
					};
				},
			};

			return overlay;
		},

		openLabels: () => stack.map((entry) => entry.label),

		stop() {
			unsubscribe();
			// Everything goes, not just the subscription. A registry that outlives
			// its context (a second createContext, or an HMR reload) would otherwise
			// keep instances nobody renders, a stack nobody owns, and a console
			// handle reporting on all of it as though it were live.
			//
			// Through the same close path as everything else, so an asker waiting on
			// an `onClose` settles instead of being abandoned mid-question.
			closeFrom(0);
			for (const instance of instances.values()) closeInstance(instance);
			instances.clear();
			stack = [];
			pathname = undefined;
			// Identity-checked, so tearing down an old registry never deletes the
			// handle a newer one has already installed.
			if ((globalThis as any).overlays === debugHandle) {
				delete (globalThis as any).overlays;
			}
		},
	};
}
