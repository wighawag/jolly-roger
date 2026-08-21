import {writable} from 'svelte/store';
import type {
	DropOutcome,
	NavigationDriver,
	NavigationLocation,
	NavigationService,
} from './types';

/**
 * The framework-free half of the navigation seam (ADR-0004).
 *
 * Constructible anywhere and inert until a driver is attached, so the context
 * can hold one on the server too (ADR-0002). Without a driver every query
 * answers "I don't know" (`undefined`) and every command is a no-op, rather than
 * throwing or guessing: nothing off-browser has a history to manipulate.
 */
export function createNavigationService(): NavigationService {
	const store = writable<NavigationLocation | undefined>(undefined);
	let location: NavigationLocation | undefined;
	let driver: NavigationDriver | undefined;

	// Held by the SERVICE, not by the driver, so a guard registered before
	// hydration (the context is built first, see ADR-0002) is not silently
	// dropped: whatever is in here when a driver attaches takes effect then.
	const unloadGuards = new Set<() => boolean>();
	/**
	 * Whether the DRIVER actually installed its unload hook.
	 *
	 * Distinct from `unloadGuards` being non-empty, and the distinction is the
	 * whole difficulty of debugging this: the app can be registering a perfectly
	 * good predicate while nothing is listening to the browser, and from outside
	 * that looks identical to the browser declining to show a dialog.
	 */
	let unloadInstalled = false;

	function shouldBlockUnload(): boolean {
		for (const guard of unloadGuards) {
			// A guard that throws must not be able to suppress the others, and must
			// not be read as "yes, block" either: a broken predicate should not trap
			// the user on the page.
			try {
				if (guard()) return true;
			} catch {
				// Nothing to do here but keep asking the rest.
			}
		}
		return false;
	}

	function sync() {
		location = driver?.read();
		store.set(location);
	}

	// Dev/debug, the same console affordance the overlay registry has, and for the
	// same reason: what a navigation bug looks like is a disagreement between
	// three things (is a driver attached, is anything guarding, and what does the
	// guard currently say), and reading them beats any amount of reasoning about
	// symptoms. `guardUnload` in particular fails SILENTLY when the driver never
	// attached, which is indistinguishable from "the browser chose not to prompt"
	// unless you can ask.
	//
	// NAMED `appNavigation`, NOT `navigation`. `window.navigation` is the standard
	// Navigation API object (Chrome 102+), which ADR-0004 discusses by name, and
	// it is an accessor with no setter: assigning to it is a TypeError in a module
	// ("Cannot set property navigation of #<Window> which has only a getter", the
	// same failure two wallet extensions produce fighting over `window.ethereum`).
	// That would throw HERE, inside context construction, and take the whole app
	// down for the sake of a console convenience. Hence a name of our own, and a
	// try/catch as well: no debug affordance is worth a blank page.
	let debugHandle: unknown;
	if (import.meta.env.DEV && typeof window !== 'undefined') {
		debugHandle = {
			/** Whether a framework driver is attached. Without one, nothing works. */
			attached: () => driver !== undefined,
			/** Whether the driver can offer an unload prompt at all. */
			canGuardUnload: () => typeof driver?.guardUnload === 'function',
			/** How many domain conditions are registered as unload guards. */
			guards: () => unloadGuards.size,
			/** Whether the driver's browser hook is actually installed. */
			unloadInstalled: () => unloadInstalled,
			/** What those guards say right now. App-side answer only. */
			wouldBlockUnload: () => shouldBlockUnload(),
			/**
			 * THE END-TO-END ANSWER: fire a real cancelable `beforeunload` and report
			 * whether anything cancelled it.
			 *
			 * `wouldBlockUnload` asks the app what it thinks; this asks the browser
			 * what would actually happen, through whatever listener is really
			 * installed. When the two disagree, the wiring is broken between the
			 * service and the driver. When they agree and a real reload still does
			 * not prompt, the browser is declining (no user activation, or a setting),
			 * and no amount of app code will change that.
			 *
			 * Touching `window` from this otherwise framework-free module is
			 * deliberate and confined to this dev-only handle: the point is to test
			 * the real browser wiring, which is exactly what a purer answer cannot do.
			 */
			simulateUnload: () => {
				const event = new Event('beforeunload', {cancelable: true});
				window.dispatchEvent(event);
				return event.defaultPrevented;
			},
			/** Where the driver thinks we are. */
			location: () =>
				location && {url: location.url.href, token: location.token},
		};
		try {
			(globalThis as any).appNavigation = debugHandle;
		} catch {
			debugHandle = undefined;
		}
	}

	return {
		subscribe: store.subscribe,

		current: () => location,

		attach(next) {
			driver = next;
			const stop = next.start(sync);
			const stopGuarding = next.guardUnload?.(shouldBlockUnload);
			unloadInstalled = stopGuarding !== undefined;
			sync();
			return () => {
				stopGuarding?.();
				unloadInstalled = false;
				stop();
				driver = undefined;
				location = undefined;
				store.set(undefined);
			};
		},

		guardUnload(shouldBlock) {
			unloadGuards.add(shouldBlock);
			return () => {
				unloadGuards.delete(shouldBlock);
			};
		},

		/** Release the debug handle. Called by whoever owns this service's life. */
		stop() {
			if (debugHandle === undefined) return;
			// Identity-checked, so tearing down an old service never deletes the
			// handle a newer one has already installed.
			if ((globalThis as any).appNavigation === debugHandle) {
				delete (globalThis as any).appNavigation;
			}
		},

		pushEphemeral(token, url) {
			if (!driver || !location) return;
			driver.push(url ?? location.url, {overlayToken: token});
			sync();
		},

		replaceEphemeral(token, url) {
			if (!driver || !location) return;
			driver.replace(url ?? location.url, {overlayToken: token});
			sync();
		},

		replaceLocation(url) {
			if (!driver || !location) return;
			// Keeps whatever token the entry already had, which for an adopted entry
			// is none: rewriting the URL must not turn somebody else's entry into
			// one we believe we may pop.
			driver.replace(url, {overlayToken: location.token});
			sync();
		},

		dropEphemeral(token, options): DropOutcome {
			if (!driver || !location) return 'ignored';

			if (location.token === token) {
				driver.go(options?.count ?? 1);
				// No sync() here: the traversal is asynchronous, and the driver
				// reports it through `notify` when it lands.
				return 'popped';
			}

			// Somebody else's entry is on top (the user navigated on, or another
			// overlay pushed after us). Leaving history alone is the whole point,
			// but a content overlay still has to stop being in the URL, and
			// replacing the current entry does that without stealing a step.
			if (options?.fallbackUrl) {
				driver.replace(options.fallbackUrl, {overlayToken: location.token});
				sync();
				return 'replaced';
			}

			return 'ignored';
		},

		urlWithParam(name, value) {
			if (!location) return undefined;
			const url = new URL(location.url);
			if (value === null) {
				url.searchParams.delete(name);
			} else {
				url.searchParams.set(name, value);
			}
			return url;
		},
	};
}
