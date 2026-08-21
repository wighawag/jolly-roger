/**
 * The navigation seam (ADR-0004, `work` branch).
 *
 * Everything the app needs to know about *where it is* and about history entries
 * it owns, expressed without naming a framework. The SvelteKit implementation of
 * {@link NavigationDriver} lives in `$lib/kit`, which is the only place allowed
 * to import `$app/*`; everything else talks to {@link NavigationService}.
 *
 * Two routing worlds have to fit through here, which is why the driver is stated
 * in terms of a whole URL rather than a route id: on path-based IPFS gateways
 * `createRouteHandler` rewrites dynamic routes to hash URLs
 * (`/explorer/tx/#0x…`, see `core/utils/web/path.ts`), so a location change is
 * not always a router event.
 */

/** Page state we own. Anything else on the entry is none of our business. */
export type NavigationState = {
	/**
	 * Marks a history entry as belonging to an open overlay. Compared before we
	 * ever call `back()`: an entry that is no longer ours belongs to the user's
	 * own navigation and must not be popped from under them.
	 */
	overlayToken?: string;
};

/** Where we are now. */
export type NavigationLocation = {
	url: URL;
	/** Token of the current history entry, when it is one of ours. */
	token?: string;
};

/**
 * The framework-specific half: four operations and a change notification.
 *
 * `push`/`replace` must create/replace a history entry WITHOUT running a page
 * navigation (SvelteKit shallow routing), so that an overlay is not a route
 * change and does not re-run `load`.
 */
export type NavigationDriver = {
	read(): NavigationLocation;
	push(url: URL, state: NavigationState): void;
	replace(url: URL, state: NavigationState): void;
	/** Traverse back `delta` entries (delta >= 1). */
	go(delta: number): void;
	/** Begin reporting location/state changes. Returns a teardown. */
	start(notify: () => void): () => void;
	/**
	 * Ask `shouldBlock()` before the document unloads, and prompt when it says
	 * yes. Returns a teardown.
	 *
	 * WILL-UNLOAD ONLY: a reload, a tab close, or leaving the origin. Never an
	 * in-app navigation, which loses nothing in a single-page app because the
	 * page's own state survives it.
	 *
	 * Optional. A driver that cannot offer this simply does not have it, and
	 * {@link NavigationService.guardUnload} becomes a no-op, which is the honest
	 * degradation: the prompt was never the safety mechanism (see ADR-0004), so
	 * losing it costs a round trip and not a transaction.
	 */
	guardUnload?(shouldBlock: () => boolean): () => void;
};

/** What `dropEphemeral` actually did, so callers can tell (and tests can assert). */
export type DropOutcome =
	/** Our entry was the current one and was traversed away from. */
	| 'popped'
	/** Not ours any more: the current entry was rewritten instead. */
	| 'replaced'
	/** Not ours and nothing to rewrite: history left alone. */
	| 'ignored';

export type NavigationService = {
	/**
	 * Current location, or `undefined` before a driver is attached: that is the
	 * server and the pre-hydration client, where there is no history to speak of
	 * (ADR-0002 keeps every service constructible there).
	 */
	subscribe: import('svelte/store').Readable<
		NavigationLocation | undefined
	>['subscribe'];
	current(): NavigationLocation | undefined;
	/** Browser-only, called by the framework adapter. Returns a teardown. */
	attach(driver: NavigationDriver): () => void;

	/**
	 * Create a history entry that belongs to an overlay.
	 *
	 * `url` defaults to the current one, so a prompt overlay changes nothing the
	 * user can see while still giving the back gesture something of ours to
	 * consume. Content overlays pass a URL carrying their param.
	 */
	pushEphemeral(token: string, url?: URL): void;

	/**
	 * Rewrite our current entry, keeping its token.
	 *
	 * Retargeting an overlay that is already open (inspect operation B while
	 * looking at operation A) must not push: the invariant everything else
	 * depends on is ONE entry per open overlay, and a second entry would leave
	 * the first stranded with a token nothing can give back.
	 */
	replaceEphemeral(token: string, url?: URL): void;

	/**
	 * Rewrite the current entry's URL WITHOUT claiming it.
	 *
	 * For an entry we did not push (a deep link, or a reload): the overlay still
	 * has to be able to change what the URL says about it, but the entry belongs
	 * to the user's own navigation, so it must not gain a token that would later
	 * let us pop it out from under them.
	 */
	replaceLocation(url: URL): void;

	/**
	 * Give back an entry created by {@link pushEphemeral}.
	 *
	 * Only pops when `token` is still the current entry, because a close can
	 * arrive long after the user has navigated on (a transaction resolving, an
	 * action completing) and popping then would yank them off a page they chose.
	 * `count` pops a whole nested stack in one traversal, since consecutive
	 * `back()` calls do not compose. `fallbackUrl` is how a content overlay still
	 * drops its param when its entry is gone.
	 */
	dropEphemeral(
		token: string,
		options?: {count?: number; fallbackUrl?: URL},
	): DropOutcome;

	/** The current URL with `name` set to `value`, or removed when null. */
	urlWithParam(name: string, value: string | null): URL | undefined;

	/**
	 * Warn before leaving the page while `shouldBlock()` is true. Returns a
	 * teardown that unregisters it.
	 *
	 * REGISTERED FROM DOMAIN STATE, NEVER FROM AN OVERLAY. The dangerous
	 * condition is a wallet request the app has not heard back about, not a modal
	 * being open, and ADR-0004 rejects tying it to the modal precisely because
	 * that loses the guard in every case where the request exists without that UI
	 * (including after the escape hatch is taken).
	 *
	 * A COURTESY, NEVER THE SAFETY MECHANISM. No dialog survives a tab crash, an
	 * OS kill or a force-quit, and the browser may refuse to show one at all
	 * without a prior user gesture. What makes losing the page survivable is the
	 * durable in-flight record and the reconciliation that follows it; this only
	 * saves the user that round trip. Anything that treats it as protection is
	 * relying on something the platform does not promise.
	 *
	 * Predicates registered before a driver attaches are kept and take effect
	 * when it does, since the context is built before hydration (ADR-0002).
	 */
	guardUnload(shouldBlock: () => boolean): () => void;

	/**
	 * Release anything held for the life of the app (currently the dev-only
	 * console handle). Detaching a driver is `attach`'s teardown; this is for the
	 * service itself, and is called from the context teardown next to
	 * `overlays.stop()`.
	 */
	stop(): void;
};
