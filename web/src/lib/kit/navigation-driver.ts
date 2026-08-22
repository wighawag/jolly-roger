import {pushState, replaceState} from '$app/navigation';
import {page} from '$app/state';
import type {
	NavigationDriver,
	NavigationLocation,
	NavigationState,
} from '$lib/core/navigation';

/**
 * The SvelteKit half of the navigation seam (ADR-0004, `work` branch).
 *
 * THE ADAPTER LAYER: `$lib/kit` is the only place that may import `$app/*`.
 * Everything else in the app talks to `NavigationService`, which is why swapping
 * the framework is a matter of writing another driver rather than auditing the
 * whole tree. See `$lib/kit/README.md`.
 *
 * `pushState`/`replaceState` are SvelteKit's shallow routing: they create or
 * rewrite a history entry WITHOUT navigating, so an overlay never re-runs
 * `load`, and `pushState(sameUrl, ...)` leaves the URL byte-for-byte identical.
 */
export type KitNavigationDriver = NavigationDriver & {
	/**
	 * Report a change the driver cannot see for itself.
	 *
	 * SvelteKit surfaces its own navigations (and its shallow-routing state)
	 * through `page`, which is only readable reactively inside a component, so
	 * the component that owns this driver pushes those in. The listeners in
	 * `start` cover the rest: the hash-based transitions that path-based IPFS
	 * gateways force on us (`core/utils/web/path.ts`), which are not always
	 * router events.
	 */
	notify(): void;
};

export function createKitNavigationDriver(): KitNavigationDriver {
	let notifyChanged: (() => void) | undefined;

	function read(): NavigationLocation {
		const state = page.state as NavigationState | undefined;
		return {
			// `window.location`, NOT `page.url`.
			//
			// Shallow routing changes the address bar without navigating: SvelteKit's
			// `pushState` calls `history.pushState` and assigns `page.state`, and
			// deliberately leaves `page.url` on the route the page is still showing
			// (client.js: `history.pushState(opts, '', resolve_url(url))` then
			// `page.state = state`). Reading `page.url` therefore reported the URL
			// WITHOUT the param we had just added, so a content overlay was judged
			// absent from the URL and closed the instant it opened: the address bar
			// changed and no modal appeared.
			//
			// `window.location` is what the address bar shows, what a reload would
			// use, and what a hash-based IPFS transition updates, so it is the one
			// answer that is right in all three worlds. The token still comes from
			// `page.state`, which is where SvelteKit keeps it.
			url: new URL(window.location.href),
			token: state?.overlayToken,
		};
	}

	return {
		read,

		push(url, state) {
			pushState(url, state as App.PageState);
		},

		replace(url, state) {
			replaceState(url, state as App.PageState);
		},

		go(delta) {
			history.go(-delta);
		},

		start(notify) {
			notifyChanged = notify;
			const onLocationChanged = () => notify();
			window.addEventListener('popstate', onLocationChanged);
			window.addEventListener('hashchange', onLocationChanged);
			return () => {
				notifyChanged = undefined;
				window.removeEventListener('popstate', onLocationChanged);
				window.removeEventListener('hashchange', onLocationChanged);
			};
		},

		guardUnload(shouldBlock) {
			// `beforeunload`, NOT SvelteKit's `beforeNavigate`, and the difference is
			// the requirement rather than a preference. The guard must fire for a
			// reload, a tab close and leaving the origin, and for nothing else;
			// `beforeNavigate` also fires for in-app navigations (where it would have
			// to be filtered by `willUnload`), it is a component-lifecycle API that
			// cannot be called from a plain module, and SvelteKit implements its own
			// `willUnload` case on this same event. Using it directly is the smaller
			// surface AND the exact semantics.
			//
			// The browser decides whether to show anything: a tab the user has not
			// interacted with is allowed to close without a prompt, and no browser
			// shows our text any more. This is why ADR-0004 calls it a courtesy.
			const onBeforeUnload = (event: BeforeUnloadEvent) => {
				if (!shouldBlock()) return;
				event.preventDefault();
				// `true`, NOT `''`. The spec asks the user to confirm when the event's
				// canceled flag is set OR `returnValue` is not the empty string, so
				// assigning the empty string is the one legacy value that means DO NOT
				// PROMPT. Browsers that predate honouring `preventDefault()` here
				// (Chrome and Edge before 119) look only at `returnValue`, so this was
				// silently a no-op on them while working in a current Chromium, which
				// is exactly the sort of difference a headless test does not show you.
				event.returnValue = true;
			};
			window.addEventListener('beforeunload', onBeforeUnload);
			return () => window.removeEventListener('beforeunload', onBeforeUnload);
		},

		notify() {
			notifyChanged?.();
		},
	};
}
