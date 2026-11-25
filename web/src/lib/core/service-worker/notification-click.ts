import {writable, type Readable} from 'svelte/store';

/**
 * THE PAGE SIDE OF A CLICK ON A NOTIFICATION (QA F19).
 *
 * A click on a system notification reaches an open tab as a message from the
 * worker (`src/service-worker/push.ts`, `NotificationClickMessage`), and a click
 * on the in-page card a focused tab shows instead reaches it as the card's
 * action. Both end here: the app follows the URL in place (the environment's
 * `navigateTo`, client-side routing, never a document load) and publishes the
 * click, so an app can act on the notification's `data` (open a conversation
 * from its ids, say) rather than on the URL alone.
 *
 * The worker waits for the ack on the message's port; a page that does not
 * answer (an older build) is navigated by the worker itself, so the ack is
 * what tells the worker not to.
 */

/** A click, as the app sees it. `id` grows with each click, so a click is told from the last one. */
export type NotificationClick = {
	id: number;
	/** where the notification leads, absolute; absent when it names nowhere */
	url?: string;
	/** the notification's `data`, as the push carried it */
	data?: unknown;
};

/**
 * The latest click, undefined before any. Subscribe where the app is composed
 * (not in a component that mounts later), since a store hands a late
 * subscriber the last click again; tell clicks apart by `id`.
 */
export type NotificationClicks = Readable<NotificationClick | undefined>;

type ClickMessage = {type: 'notification-click'; url?: string; data?: unknown};

function isClickMessage(data: unknown): data is ClickMessage {
	return (
		!!data &&
		typeof data === 'object' &&
		(data as {type?: unknown}).type === 'notification-click'
	);
}

/**
 * Whether `target` is the page already shown: origin, path (with or without a
 * trailing slash, the app redirects one to the other), query and hash.
 */
export function isCurrentPage(target: string, current: string): boolean {
	let x: URL;
	let y: URL;
	try {
		x = new URL(target, current);
		y = new URL(current);
	} catch {
		return false;
	}
	const path = (url: URL) => url.pathname.replace(/\/+$/, '');
	return (
		x.origin === y.origin &&
		path(x) === path(y) &&
		x.search === y.search &&
		x.hash === y.hash
	);
}

export function createNotificationClicks(options: {
	/** follow a URL in place, without a document load (`$lib/kit`'s) */
	navigateTo: (url: string) => void;
	/** the page's URL now */
	currentHref: () => string;
}) {
	const store = writable<NotificationClick | undefined>(undefined);
	let lastId = 0;

	/** Take a click: go where it leads unless already there, then publish it. */
	function take(click: {url?: string; data?: unknown}) {
		if (click.url && !isCurrentPage(click.url, options.currentHref())) {
			options.navigateTo(click.url);
		}
		store.set({id: ++lastId, url: click.url, data: click.data});
	}

	/**
	 * A message from the worker: true when it was a click, taken and answered on
	 * its port; false for any other message, left to the caller.
	 */
	function handleMessage(event: MessageEvent): boolean {
		if (!isClickMessage(event.data)) {
			return false;
		}
		take(event.data);
		event.ports?.[0]?.postMessage({type: 'notification-click-ack'});
		return true;
	}

	return {
		clicks: {subscribe: store.subscribe} as NotificationClicks,
		take,
		handleMessage,
	};
}
