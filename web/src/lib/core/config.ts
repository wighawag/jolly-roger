import {version} from '$app/environment';
import {createServiceWorker} from './service-worker';
import {createNotificationsService} from './notifications';
import {
	getHashParamsFromLocation,
	getParamsFromLocation,
} from './utils/web/url';
import {createRouteHandler, resolvePath} from '$lib/kit/paths';
import {openFromNotification} from '$lib/kit/notification-navigation';

/**
 * The notifications service is generic: a notification is just a title/body/
 * icon plus an optional action. Anything push-notification specific (such as
 * navigating on click) is adapted into that shape by the service worker.
 */
export const notifications = createNotificationsService();
export const serviceWorker = createServiceWorker(
	{resolvePath, navigateTo: openFromNotification},
	notifications,
);

export const hashParams = getHashParamsFromLocation();
const {params: paramsFromLocation} = getParamsFromLocation();

export const globalQueryParams = [
	'debug',
	'debugLevel',
	'traceLevel',
	'debugLabel',
	'eruda',
] as const;

/**
 * Build links with `route(...)` so the `globalQueryParams` above survive
 * navigation. It accepts app-absolute (`/blog/`) and relative (`../`, `./`,
 * `blog/`) paths alike, and returns external URLs untouched.
 */
export const {route, isSameRoute, isParentRoute, params} = createRouteHandler(
	paramsFromLocation,
	{
		globalQueryParams,
		// Add entries here for routes whose last segment is dynamic, so they keep
		// working on path-based IPFS gateways. e.g.:
		// {pattern: /^(\/post\/)([^/]+)\/?$/, basePath: '/post/'}
		dynamicRoutes: [],
	},
);

console.log(`VERSION: ${version}`);
