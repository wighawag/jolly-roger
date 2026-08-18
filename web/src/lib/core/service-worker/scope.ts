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
 * Would registering `swURL` disturb the worker currently controlling the page?
 *
 * `controllerScriptURL` is `navigator.serviceWorker.controller?.scriptURL`, so
 * null/undefined means the page is not currently controlled.
 *
 * True whenever a worker that is not ours controls this page. False when the
 * page is uncontrolled (nothing to disturb) or the controller IS our own worker
 * (register again, to keep the update flow alive).
 *
 * WHY THIS DOES NOT COMPARE SCOPES, which is the obvious "improvement" to make
 * here and is wrong. A controlling worker's scope cannot be determined
 * synchronously: `ServiceWorker` does not expose its scope, and deriving it
 * from the script's directory is a guess that a registration can invalidate by
 * opting into a WIDER scope via `Service-Worker-Allowed` or an explicit
 * `{scope}` argument.
 *
 * That guess is not merely theoretically weak, it is wrong against a real
 * service worker gateway. Verified against `ipfs-gateway-emulator --gateway sw`
 * (see the E2E suite): its worker is at `/ipfs-sw-emulator/sw.js` but registers
 * with `{scope: '/'}`, so the script directory says `/ipfs-sw-emulator/` while
 * the true scope is `/`. A directory-based test concludes there is no overlap,
 * skips the guard, and registers straight over a gateway that is serving the
 * page.
 *
 * The real scope is only reachable through the async
 * `navigator.serviceWorker.getRegistrations()`, and awaiting that before
 * registering would put a round-trip on EVERY first visit (an uncontrolled page
 * is exactly the first-visit signature) to buy precision in a rare case. So
 * this stays synchronous and conservative instead.
 *
 * The asymmetry is what justifies being conservative: over-firing costs offline
 * support and push on an origin where registering would have been fine, and the
 * site still works, while under-firing silently breaks a trustless gateway and
 * the site with it. A foreign worker scoped DEEPER than us would in principle
 * keep this page by longest-match and be safe to register alongside, but we
 * cannot tell that case apart from the destructive ones without the scope, so
 * it is treated as destructive too.
 */
export function wouldDisturbForeignWorker(
	swURL: string,
	controllerScriptURL: string | null | undefined,
): boolean {
	if (!controllerScriptURL) {
		return false;
	}
	return controllerScriptURL !== swURL;
}
