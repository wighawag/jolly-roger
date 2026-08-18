/**
 * Scope arithmetic for deciding whether it is safe to register our service
 * worker, split out from `./index.ts` so it can be unit tested.
 *
 * DELIBERATELY FREE OF IMPORTS, including `$app/*` and svelte. Everything here
 * is pure string work over URLs, so the unit test in
 * `test/lib/core/service-worker/scope.test.ts` needs no DOM, no browser and no
 * SvelteKit resolution. Keep it that way: the value of this file is that the
 * one rule most likely to be "simplified" back into a bug is the one rule that
 * is cheap to test.
 */

/**
 * The scope a registration of `scriptURL` claims by default: the script's
 * directory, as an absolute URL ending in `/`.
 *
 * This is an approximation of the real thing. A registration can opt into a
 * WIDER scope than its directory via the `Service-Worker-Allowed` header, and
 * an active `ServiceWorker` object does not expose its scope, so a foreign
 * worker that did so will be understated here. See the KNOWN GAPS note in
 * `./index.ts`.
 */
export function defaultScopeOf(scriptURL: string): string {
	return new URL(`./`, scriptURL).href;
}

/**
 * Would registering `swURL` disturb the worker currently controlling the page?
 *
 * `controllerScriptURL` is `navigator.serviceWorker.controller?.scriptURL`, so
 * null/undefined means the page is not currently controlled.
 *
 * True in exactly the two destructive cases:
 *   - the controller's scope EQUALS ours, so our registration replaces theirs
 *     (registrations are keyed by scope)
 *   - the controller's scope is an ANCESTOR of ours, so nothing is replaced but
 *     our narrower registration takes control of the page away from theirs,
 *     because a client is controlled by the LONGEST matching scope
 *
 * False when:
 *   - the page is not controlled at all, so there is nothing to disturb
 *   - the controller IS our own worker, in which case we register again to keep
 *     the update flow alive
 *   - the controller is scoped DEEPER than us, so it keeps this page by
 *     longest-match and we cannot displace it
 *
 * Both scopes always end in `/`, which is what makes the prefix test safe
 * against sibling directories: `/app/` does not prefix-match `/app2/`.
 */
export function wouldDisturbForeignWorker(
	swURL: string,
	controllerScriptURL: string | null | undefined,
): boolean {
	if (!controllerScriptURL) {
		return false;
	}
	if (controllerScriptURL === swURL) {
		return false;
	}
	return defaultScopeOf(swURL).startsWith(defaultScopeOf(controllerScriptURL));
}
