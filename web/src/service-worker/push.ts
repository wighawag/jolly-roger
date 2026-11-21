/**
 * WHAT A PUSH CARRIES, AND WHAT THE SERVICE WORKER MAKES OF IT.
 *
 * The payload is the Declarative Web Push shape (`web_push: 8030`, the WebKit
 * proposal a push server sends), declared ONCE, here: the worker reads it, and
 * a descendant whose push server has its own type checks that type against
 * this one rather than declaring the shape again.
 *
 * The two functions are the worker's push and click handlers without the
 * browser around them, so they are tested in Node
 * (test/service-worker/push.test.ts): the worker (`./index.ts`) calls them and
 * owns the `showNotification`, the post to a focused page, and the navigation.
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
