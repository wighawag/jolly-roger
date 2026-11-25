import {goto} from '$app/navigation';

/**
 * Follow a URL carried by a push notification (absolute), in place.
 *
 * Client-side routing, so the app moves to that page without a document load
 * and keeps the state it already has: the notification arrives in a running
 * app, and the user clicking it is asking to be taken somewhere in that app,
 * not to start it again (QA F19: a click used to reload the tab). It is a real
 * navigation, unlike the shallow `pushState` this used to be, which changed the
 * URL and left the page it was on. A URL outside the app is loaded as a
 * document, which is all a browser can do with it.
 *
 * Never called for the page already shown: `$lib/core/service-worker` checks.
 */
export function openFromNotification(url: string): void {
	if (new URL(url, location.href).origin !== location.origin) {
		location.assign(url);
		return;
	}
	goto(url).catch((e) => console.warn(`could not open ${url}`, e));
}
