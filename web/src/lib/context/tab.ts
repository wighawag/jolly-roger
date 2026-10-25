import type {NavigationService} from '$lib/core/navigation/index.js';
import type {OverlayRegistry} from '$lib/core/ui/overlay/index.js';

/**
 * THE TAB'S NAVIGATION, lent by the app's own context to every other context
 * in the same tab (a world beside the app: see `establishConnection` in
 * `./core.ts`).
 *
 * WHAT WENT WRONG WITHOUT IT. Every context built its own navigation service,
 * and only the app's ever gets a driver (`$lib/kit`'s `KitNavigation`, mounted
 * once in the layout). A world's context was therefore inert: an overlay it
 * opened pushed no history entry, so the back gesture meant to close it left
 * the page, which for a world in the tab throws the world away; its unload
 * guard was inert for the same reason. Measured on template-commit-reveal's
 * `/offline`; jolly-roger's `/offline-demo` had the same shape.
 *
 * WHY A SCOPE OF THE APP'S REGISTRY, not the registry and not a registry of
 * its own: see `OverlayRegistry.scope`.
 *
 * IMPLICIT, rather than a parameter, because a world is built where the app's
 * context cannot be seen: an app-scoped module (a lobby, a world store) calls
 * `createContext({establishConnection})`, while the app's context lives in the
 * layout's svelte context. "No `establishConnection`" already means "the app's
 * own context", so that is the one that lends.
 *
 * BROWSER ONLY. On the server a module variable is shared by every request,
 * and there is no history to share; a world is never built there. The latest
 * app context wins, which is what an HMR reload of the layout wants.
 */
/*
 * `establishConnection` MEANS "NOT THE APP'S CONTEXT". A descendant that passes
 * one for its own app context lends nothing, and its worlds stay inert.
 */
export type TabNavigation = {
	navigation: NavigationService;
	overlays: OverlayRegistry;
	/** Namespace for this context's overlays in the shared registry. */
	scope: string;
};

let lent: Pick<TabNavigation, 'navigation' | 'overlays'> | undefined;
let worlds = 0;

/**
 * Returns a revoke for the app context's teardown. Identity-checked, so a
 * stopping old app context (an HMR reload of the layout) never revokes the
 * lend a newer one has already made. A world built before that reload keeps
 * the old, stopped registry and is inert until it is rebuilt: a world does
 * not survive an app HMR.
 */
export function lendTabNavigation(
	tab: Pick<TabNavigation, 'navigation' | 'overlays'>,
): () => void {
	if (typeof window === 'undefined') return () => {};
	lent = tab;
	return () => {
		if (lent === tab) lent = undefined;
	};
}

export function borrowTabNavigation(): TabNavigation | undefined {
	if (typeof window === 'undefined') return undefined;
	if (!lent) {
		if (import.meta.env.DEV) {
			console.warn(
				"[context] a second context was created before the app's own, so " +
					'it has no history to share: its overlays will not push entries ' +
					'and the back gesture will leave the page. Create the app context ' +
					'(the layout does) before any world.',
			);
		}
		return undefined;
	}
	// A COUNTER, so the name is only stable for the first world of a page
	// load: a content overlay of a later world is addressed as `world-2.<param>`
	// and a reload, which numbers worlds afresh, will not adopt it. Nothing
	// deep-links into a world's overlay today; a world that needs to should
	// get a stable name passed in here.
	worlds++;
	return {...lent, scope: `world-${worlds}`};
}

/** Tests only: module state outlives a test, and order must not matter. */
export function resetTabNavigationForTests(): void {
	lent = undefined;
	worlds = 0;
}
