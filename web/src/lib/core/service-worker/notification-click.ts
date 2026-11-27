import {writable, type Readable} from 'svelte/store';
import {splitUrlPushHandoff, type PushHandoffs} from './push-handoff';

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
 *
 * A PUSH'S HAND-OFF (QA F23, `./push-handoff.ts`). Where the worker never runs
 * (Safari's Declarative Web Push), a click only loads the notification's URL,
 * and a service carries what the app needs in its fragment,
 * `#push-handoff=...`. The page reads it from its URL and it is published here
 * as a click too, its `data` the hand-off (`{missiv: ...}`), so an app acts on
 * a notification the same way whichever path it came by. A click's URL is
 * routed and published WITHOUT its hand-off: `isCurrentPage` compares the
 * hash, so a click on `/#push-handoff=...` from the root would otherwise route
 * to it and leave it in the address bar.
 */

/** A click, as the app sees it. `id` grows with each click, so a click is told from the last one. */
export type NotificationClick = {
	id: number;
	/** where the notification leads, absolute, without its hand-off; absent when it names nowhere */
	url?: string;
	/**
	 * the notification's `data`, as the push carried it; for a hand-off the page
	 * read from its URL, the hand-off
	 */
	data?: unknown;
};

/**
 * How long after the page read a hand-off a worker click carrying the same one
 * is the same click: with no tab open, the worker opens one on the
 * notification's URL (which the page reads on load), then hands it the click.
 */
export const SAME_CLICK_WINDOW_MS = 10_000;

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
	/** the hand-offs the page reads from its URL (`./push-handoff.ts`) */
	pushHandoffs?: PushHandoffs;
	/** the time, for the hand-off a worker click repeats */
	now?: () => number;
}) {
	const store = writable<NotificationClick | undefined>(undefined);
	const now = options.now ?? Date.now;
	let lastId = 0;
	let lastRead: {handoff: string; at: number} | undefined;

	/** Take a click: go where it leads unless already there, then publish it. */
	function take(click: {url?: string; data?: unknown}) {
		const split = click.url ? splitUrlPushHandoff(click.url) : undefined;
		const read = lastRead;
		if (
			split?.handoff &&
			read &&
			read.handoff === JSON.stringify(split.handoff) &&
			now() - read.at <= SAME_CLICK_WINDOW_MS
		) {
			// the page read this hand-off from the URL the worker opened it on:
			// already taken
			lastRead = undefined;
			return;
		}
		const url = split?.url;
		if (url && !isCurrentPage(url, options.currentHref())) {
			options.navigateTo(url);
		}
		store.set({id: ++lastId, url, data: click.data});
	}

	let handoffTaken = 0;
	options.pushHandoffs?.subscribe((read) => {
		if (!read || read.id <= handoffTaken) {
			return;
		}
		handoffTaken = read.id;
		lastRead = {handoff: JSON.stringify(read.handoff), at: now()};
		// the page is already there: nothing to route
		store.set({id: ++lastId, url: read.url, data: read.handoff});
	});

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
