import {pushState} from '$app/navigation';
import {page} from '$app/state';

/**
 * Follow a URL carried by a push notification.
 *
 * Shallow routing, so the app moves without a document load and without losing
 * the state it already has: the notification arrives in a running app, and the
 * user pressing its action is asking to be taken somewhere in that app, not to
 * start it again.
 *
 * `page.state` is passed through unchanged rather than cleared, so anything the
 * app had recorded on the current entry survives the move.
 */
export function openFromNotification(url: string): void {
	pushState(url, page.state);
}
