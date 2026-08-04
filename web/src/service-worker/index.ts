/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="../../.svelte-kit/ambient.d.ts" />

import {build, version, prerendered, files} from '$service-worker';

const ID = version; // + '-1';

const sw = self as unknown as ServiceWorkerGlobalScope;

// ------------------- CONFIG ---------------------------
const DEV = true;
const OFFLINE_CACHE = 'all';
// Icon/badge used for the DEFAULT push notification (when the push payload
// carries no icon of its own). pwag regenerates pwa/favicon-512.png from
// src/web-config.json's `icon` on every build, so the image content is already
// config-driven; keep the path here in ONE place so a fork that renames the
// generated file only edits this line.
//
// The path is resolved relative to the service worker's own URL (not the
// origin root) so it works under a base path / IPFS gateway, where the app is
// served from a sub-path and an absolute "/pwa/…" URL would miss the prefix.
// This mirrors the approach already used in handleNotificationClick below.
const swFolder = sw.location.pathname.substring(
	0,
	sw.location.pathname.lastIndexOf('/') + 1,
);
const NOTIFICATION_ICON = swFolder + 'pwa/favicon-512.png';
// ------------------------------------------------------

let ASSETS: string[] = [];
if (OFFLINE_CACHE === 'all') {
	ASSETS = build
		.concat(prerendered)
		.concat(files.filter((v) => v.indexOf('pwa/') === -1));
}
// NOTE: could support more cache option than just 'all;

let _logEnabled = false;
function log(...args: any[]) {
	if (_logEnabled) {
		console.debug(`[Service Worker #${ID}] ${args[0]}`, ...args.slice(1));
	}
}

// Create a unique cache name for this deployment
const CACHE_NAME = `cache-${version}`;

const regexesOnlineFirst: string[] = [];
if (DEV) {
	regexesOnlineFirst.push('localhost');
}

const regexesOnlineOnly: string[] = [];

// NOTE: we could add more caching option, fonts for example could come to a specific domain
//  Also we might not want to cache all .pngs / .svgs
const regexesCacheFirst = [sw.location.origin, 'cdn', '.*\\.png$', '.*\\.svg$'];

const regexesCacheOnly: string[] = [];

// If the url doesn't match any of those regexes, it will do online first

log(`Origin: ${sw.location.origin}`);

sw.addEventListener('install', (event) => {
	log('Install');
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => {
				log(`Creating cache: ${CACHE_NAME}`);
				return cache.addAll(ASSETS);
			})
			.then(() => {
				// sw.skipWaiting();
				log(`cache fully fetched!`);
			}),
	);
});

sw.addEventListener('activate', (event) => {
	log('Activate');
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((thisCacheName) => {
					if (thisCacheName !== CACHE_NAME) {
						log(`Deleting: ${thisCacheName}`);
						return caches.delete(thisCacheName);
					}
				}),
			).then(() => sw.clients.claim());
		}),
	);
});

async function fetchAndUpdateCache(request: Request, cache?: Response) {
	try {
		const response = await fetch(request);
		try {
			const cache_1 = await caches.open(CACHE_NAME);
			if (request.method === 'GET' && request.url.startsWith('http')) {
				// only on http protocol to prevent chrome-extension request to error out
				cache_1.put(request, response.clone());
			}
			return response;
		} catch (err) {
			log(`error: ${err}`);
			return response;
		}
	} catch (err_1) {
		if (cache) {
			return cache;
		} else {
			return new Response(`Could Not fetch ${request.url}`, {
				status: 503,
				headers: {'Content-Type': 'text/plain'},
			});
		}
	}
}

const cacheFirst = {
	method: (request: Request, cache?: Response) => {
		log(`Cache first: ${request.url}`);
		const fromNetwork = fetchAndUpdateCache(request, cache);
		return cache || fromNetwork;
	},
	regexes: regexesCacheFirst,
};

const cacheOnly = {
	method: (request: Request, cache?: Response) => {
		log(`Cache only: ${request.url}`);
		return cache || fetchAndUpdateCache(request, cache);
	},
	regexes: regexesCacheOnly,
};

const onlineFirst = {
	method: (request: Request, cache?: Response) => {
		log(`Online first: ${request.url}`);
		return fetchAndUpdateCache(request, cache);
	},
	regexes: regexesOnlineFirst,
};

const onlineOnly = {
	method: (request: Request) => {
		log(`Online only: ${request.url}`);
		return fetch(request);
	},
	regexes: regexesOnlineOnly,
};

async function getResponse(event: FetchEvent): Promise<Response> {
	const request = event.request;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const registration = sw.registration;
	if (
		event.request.mode === 'navigate' &&
		event.request.method === 'GET' &&
		registration.waiting &&
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(await sw.clients.matchAll()).length < 2
	) {
		log('only one client, skipWaiting as we navigate the page');
		registration.waiting.postMessage('skipWaiting');
		const response = new Response('', {headers: {Refresh: '0'}});
		return response;
	}

	// Note we could remove query param from matching
	//  that is, if query param are used as config
	//  we could then do: const normalizedUrl = normalizeUrl(event.request.url);
	const response = await caches.match(request).then((cache) => {
		// The order matters !
		const patterns = [onlineFirst, onlineOnly, cacheFirst, cacheOnly];

		for (const pattern of patterns) {
			for (const regex of pattern.regexes) {
				if (RegExp(regex).test(request.url)) {
					return pattern.method(request, cache);
				}
			}
		}

		return onlineFirst.method(request, cache);
	});
	return response;
}

sw.addEventListener('fetch', (event: FetchEvent) => {
	event.respondWith(getResponse(event));
});

// ------------------------------------------------------------------------------------------------
// MESSAGES FROM APP
// ------------------------------------------------------------------------------------------------

sw.addEventListener('message', async function (event) {
	if (event.data && event.data.type === 'debug') {
		// enable or disable logging
		// just need to send a object as message like {type: "debug", enabled: true, level: 5}
		_logEnabled = event.data.enabled && event.data.level >= 5;
		if (_logEnabled) {
			log(`log enabled ${event.data.level}`);
		}
	} else if (event.data && event.data.type === 'ping') {
		// to test replies from service worker and get its versio
		// see log function
		log('pong');
	} else if (event.data === 'skipWaiting') {
		// force the pending service worker to be activated
		log(`skipWaiting received`);
		event.waitUntil(sw.skipWaiting());
	}
});

// ------------------------------------------------------------------------------------------------
// PUSH NOTIFICATIONS
// ------------------------------------------------------------------------------------------------

async function getClientsStatus(): Promise<{
	atLeastOneVisible: WindowClient | undefined;
	atLeastOneFocused: WindowClient | undefined;
	atLeastOneVisibleAndFocused: WindowClient | undefined;
}> {
	// TODO: track last-active client so that when none is both focused and visible,
	// we can pick the best window to focus/navigate to.
	const windowClients = await sw.clients.matchAll({
		type: 'window',
		includeUncontrolled: true,
	});

	let atLeastOneVisible: WindowClient | undefined;
	let atLeastOneFocused: WindowClient | undefined;
	let atLeastOneVisibleAndFocused: WindowClient | undefined;
	for (var i = 0; i < windowClients.length; i++) {
		const windowClient = windowClients[i];
		const visible = windowClient.visibilityState === 'visible';
		const hasFocus = windowClient.focused;
		if (visible && !atLeastOneVisible) {
			atLeastOneVisible = windowClient;
		}
		if (hasFocus && !atLeastOneFocused) {
			atLeastOneFocused = windowClient;
		}
		if (hasFocus && visible) {
			atLeastOneVisibleAndFocused = windowClient;
			break;
		}
	}

	return {
		atLeastOneFocused,
		atLeastOneVisible,
		atLeastOneVisibleAndFocused,
	};
}

type NotificationAction = {
	action: string;
	title: string;
	navigate: string;
	icon?: string;
};
type DeclarativePushNotification = {
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

async function handlePush(data?: string) {
	const appActive = await getClientsStatus();

	const notificationTuple: {title: string; options: NotificationOptions} = {
		title: 'Notification',
		options: {
			body: 'You have a new notification',
			icon: NOTIFICATION_ICON,
			badge: NOTIFICATION_ICON,
		},
	};

	if (data) {
		try {
			const json: DeclarativePushNotification = JSON.parse(data);
			if (json.web_push === 8030) {
				const notif = json.notification;
				notificationTuple.options = {
					badge: notif.badge,
					body: notif.body,
					data: notif.data,
					dir: notif.dir,
					icon: notif.icon,
					lang: notif.lang,
					requireInteraction: notif.requireInteraction,
					silent: notif.silent,
					tag: notif.tag,
				};
				notificationTuple.title = notif.title;

				if (!notificationTuple.options.icon) {
					notificationTuple.options.icon = notif.image;
				}

				if (notif.navigate) {
					if (!notificationTuple.options.data) {
						notificationTuple.options.data = {navigate: notif.navigate};
					} else {
						if (
							typeof notificationTuple.options.data === 'object' &&
							!notificationTuple.options.data.navigate
						) {
							notificationTuple.options.data = {
								...notificationTuple.options.data,
								navigate: notif.navigate,
							};
						}
					}
				}
				// TODO: handle additional notification attributes (e.g. actions, image, vibrate).
				// notif.actions
				// notif.vibrate
				// notif.timestamp
				// notif.renotify
			} else {
				// Fallback for legacy notification format with root-level title/options
				notificationTuple.title =
					json.notification?.title || (json as any).title || 'Notification';
				notificationTuple.options = json.notification || (json as any).options;
			}
		} catch {
			notificationTuple.options.body = data;
		}
	}

	log(`handlePush`, data, notificationTuple);

	if (appActive.atLeastOneVisibleAndFocused) {
		log(`posting notification to active app`, notificationTuple);
		appActive.atLeastOneVisibleAndFocused.postMessage({
			type: 'notification',
			notification: {
				title: notificationTuple.title,
				options: notificationTuple.options,
			},
		});
	} else {
		await sw.registration.showNotification(
			notificationTuple.title,
			notificationTuple.options,
		);
	}
}
sw.addEventListener('push', function (event: PushEvent) {
	const data = event.data?.text();
	event.waitUntil(handlePush(data));
});

async function handleNotificationClick(notification: Notification) {
	const windowClients = await sw.clients.matchAll({
		type: 'window',
		includeUncontrolled: true,
	});

	const swPath = location.pathname;
	const swFolder = swPath.substring(0, swPath.lastIndexOf('/') + 1);

	let url = notification.data?.navigate;
	if (url) {
		if (!url.startsWith('/') && url.indexOf(':/') == -1) {
			url = swFolder + url;
		}
	}

	for (const client of windowClients) {
		log(`${'focus' in client ? 'focus-available: ' : ''}: ${client.url}`);
		// TODO: prefer a client already on the target URL (or on '/') instead of
		// focusing the first focusable client.
		if ('focus' in client) {
			if (url && 'navigate' in client) {
				return client.focus().then(() => client.navigate(url));
			}
			return client.focus();
		}
	}
	if (sw.clients.openWindow) return sw.clients.openWindow(url || '/');
}

sw.addEventListener('notificationclick', function (event: NotificationEvent) {
	event.notification.close();

	event.waitUntil(handleNotificationClick(event.notification));
});
