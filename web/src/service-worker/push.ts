/**
 * WHAT A PUSH CARRIES, AND WHAT THE SERVICE WORKER MAKES OF IT.
 *
 * The payload is the Declarative Web Push shape (`web_push: 8030`, the WebKit
 * proposal a push server sends), declared ONCE, here: the worker reads it, and
 * a descendant whose push server has its own type checks that type against
 * this one rather than declaring the shape again.
 *
 * The functions are the worker's push and click handlers without the browser
 * around them, so they are tested in Node (test/service-worker/push.test.ts):
 * the worker (`./index.ts`) calls them and owns the `showNotification`, the
 * post to a focused page, the focus and the fallback navigation.
 *
 * THE CLICK CONTRACT (QA F19): a click on a notification does not reload a page
 * that is already open. The worker picks an open tab of the app (one already on
 * the notification's URL first), focuses it and posts it a
 * `NotificationClickMessage` with a `MessagePort`; the page routes in place (no
 * document load) and answers `NotificationClickAck` on that port. Only when no
 * tab is open does the worker open one, and only when the tab does not answer
 * in time (a page from an older build, which does not listen) does it navigate
 * that tab the old way. The page side is `$lib/core/service-worker`.
 *
 * NO IMPORT: the service worker bundles this file, and nothing of the app may
 * reach it.
 */

export type NotificationAction = {
	action: string;
	title: string;
	navigate: string;
	icon?: string;
};

export type DeclarativePushNotification = {
	web_push: 8030;
	notification: {
		title: string;
		navigate: string;
		dir?: NotificationDirection;
		lang?: string;
		body?: string;
		tag?: string;
		image?: string;
		icon?: string;
		badge?: string;
		vibrate?: number[];
		timestamp?: number;
		renotify?: boolean;
		silent?: boolean;
		requireInteraction?: boolean;
		data?: Record<string, unknown>;
		actions?: NotificationAction[];
	};
	app_badge?: number;
	mutable?: boolean;
};

export type PushedNotification = {title: string; options: NotificationOptions};

/**
 * The notification a push's text becomes: a declarative push read field by
 * field (its `navigate` kept in `data`, where `notificationTarget` reads it),
 * the legacy `{title, options}` shape as it is, any other text as the body, and
 * no text as a default. `icon` is the app's, used for the default and for a
 * push naming no icon nor image (and no badge): the worker's comment always
 * said so, but its inlined handler let a declarative push replace the options
 * whole, so a push naming no icon showed none.
 */
export function notificationFromPush(
	data: string | undefined,
	icon: string,
): PushedNotification {
	const shown: PushedNotification = {
		title: 'Notification',
		options: {
			body: 'You have a new notification',
			icon,
			badge: icon,
		},
	};
	if (!data) {
		return shown;
	}

	let json: DeclarativePushNotification;
	try {
		json = JSON.parse(data);
	} catch {
		shown.options.body = data;
		return shown;
	}

	if (json.web_push !== 8030) {
		// the legacy format, a title and options at the root
		const legacy = json as unknown as {
			title?: string;
			options?: NotificationOptions;
			notification?: {title?: string} & NotificationOptions;
		};
		return {
			title: legacy.notification?.title || legacy.title || 'Notification',
			options: legacy.notification || legacy.options || {},
		};
	}

	const notification = json.notification;
	const options: NotificationOptions = {
		badge: notification.badge || icon,
		body: notification.body,
		data: notification.data,
		dir: notification.dir,
		icon: notification.icon || notification.image || icon,
		lang: notification.lang,
		requireInteraction: notification.requireInteraction,
		silent: notification.silent,
		tag: notification.tag,
	};
	if (notification.navigate) {
		if (!options.data) {
			options.data = {navigate: notification.navigate};
		} else if (typeof options.data === 'object' && !options.data.navigate) {
			options.data = {...options.data, navigate: notification.navigate};
		}
	}
	// TODO: handle additional notification attributes (actions, image, vibrate,
	// timestamp, renotify).
	return {title: notification.title, options};
}

/**
 * What the worker posts to an open tab when its notification is clicked: where
 * to go (absent when the notification names nowhere: the tab is only focused)
 * and the notification's `data`, so the app can act on more than a URL (open a
 * conversation from its ids, say).
 */
export type NotificationClickMessage = {
	type: 'notification-click';
	url?: string;
	data?: unknown;
};

/** What the page answers on the message's port once it has taken the click. */
export type NotificationClickAck = {type: 'notification-click-ack'};

/**
 * How long the worker waits for a tab to take a click before navigating it
 * itself. A page of this build answers within a task or two; one of an older
 * build never does.
 */
export const NOTIFICATION_CLICK_ACK_TIMEOUT_MS = 1500;

/** The fields of a `WindowClient` the choice reads. */
export type ClickableClient = {
	url: string;
	focused?: boolean;
	visibilityState?: string;
};

/**
 * Whether two URLs show the same page: origin, path and query, with or without
 * a trailing slash (the app redirects one to the other), the hash ignored.
 */
export function samePage(a: string, b: string): boolean {
	let x: URL;
	let y: URL;
	try {
		x = new URL(a);
		y = new URL(b);
	} catch {
		return false;
	}
	const path = (url: URL) => url.pathname.replace(/\/+$/, '');
	return x.origin === y.origin && path(x) === path(y) && x.search === y.search;
}

/**
 * The open tab a click goes to: one already on `target` (an absolute URL) when
 * there is one, else the focused one, else a visible one, else the first;
 * undefined when no tab is open. Among several on the target, the same order.
 */
export function clientForNotification<T extends ClickableClient>(
	clients: readonly T[],
	target: string | undefined,
): T | undefined {
	const rank = (client: T) =>
		client.focused ? 0 : client.visibilityState === 'visible' ? 1 : 2;
	const best = (list: readonly T[]) =>
		list.reduce<T | undefined>(
			(chosen, client) =>
				!chosen || rank(client) < rank(chosen) ? client : chosen,
			undefined,
		);
	const onTarget = target
		? clients.filter((client) => samePage(client.url, target))
		: [];
	return best(onTarget) ?? best(clients);
}

/** The part of a `Client` `askClient` needs. */
export type MessageTarget = {
	postMessage(message: unknown, transfer: Transferable[]): void;
};

/**
 * Post `message` to a tab with a port and resolve whether it answered
 * `NotificationClickAck` within `timeoutMs`. Never rejects: a tab that cannot
 * be posted to has not taken the click.
 */
export function askClient(
	client: MessageTarget,
	message: NotificationClickMessage,
	timeoutMs: number = NOTIFICATION_CLICK_ACK_TIMEOUT_MS,
): Promise<boolean> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const done = (taken: boolean) => {
			clearTimeout(timer);
			channel.port1.onmessage = null;
			channel.port1.close();
			resolve(taken);
		};
		const timer = setTimeout(() => done(false), timeoutMs);
		channel.port1.onmessage = (event: MessageEvent) => {
			if (
				(event.data as NotificationClickAck | undefined)?.type ===
				'notification-click-ack'
			) {
				done(true);
			}
		};
		try {
			client.postMessage(message, [channel.port2]);
		} catch {
			done(false);
		}
	});
}

/**
 * Where a click on a notification navigates: its `data.navigate`, a relative
 * path resolved against the service worker's folder (so an app served under a
 * base path or an IPFS gateway keeps its prefix), an absolute path or a URL as
 * it is; undefined when it names nowhere.
 */
export function notificationTarget(
	data: {navigate?: string} | undefined,
	swFolder: string,
): string | undefined {
	const url = data?.navigate;
	if (!url) {
		return undefined;
	}
	if (!url.startsWith('/') && url.indexOf(':/') == -1) {
		return swFolder + url;
	}
	return url;
}
