/**
 * Run `callback` once the document has been parsed, or immediately if that
 * already happened.
 *
 * Two things here are load-bearing and easy to "clean up" into bugs:
 *
 * 1. IT WAITS FOR `DOMContentLoaded`, NOT WINDOW'S `load`. Window `load` waits
 *    for every subresource and is much later, late enough that a caller wanting
 *    to observe early document-lifecycle events would miss them. Waiting for
 *    `DOMContentLoaded` also keeps this branch equivalent to the synchronous
 *    one below, since `readyState` is already past `loading` by the time
 *    `DOMContentLoaded` fires.
 *
 * 2. IT CALLS BACK SYNCHRONOUSLY when the document is already parsed. That is
 *    deliberate, not an oversight: it lets the caller attach its listeners in
 *    the same task, before the browser can dispatch anything at them. Do NOT
 *    "fix" the inconsistent sync/async shape by always deferring, some callers
 *    depend on winning that race (see the service worker registration in
 *    `src/routes/+layout.ts` for a concrete one).
 *
 * Previously the waiting branch was `document.addEventListener('load', ...)`,
 * which never fires: `load` targets `window` and does not bubble, so `document`
 * never sees it. A document still in `loading` state therefore never ran the
 * callback at all, and the service worker was never registered. It went
 * unnoticed because the synchronous branch almost always wins during hydration.
 */
export function onDocumentLoaded(callback: () => void) {
	if (typeof document === 'undefined') {
		return;
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', callback, {once: true});
	} else {
		// already parsed (`interactive` or `complete`): run now, same task
		callback();
	}
}
