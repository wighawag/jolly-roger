/**
 * Where this app is composed.
 *
 * Everything under `core/` is written to not know which app it is running in,
 * so somebody has to hand the pieces to each other and supply the framework's
 * answers. That is this file, and keeping it OUT of `core/` is what lets the
 * rule in `test/framework-boundary.test.ts` be true: it imports
 * `$app/environment` and `./kit/*`, which is exactly what a composition root is
 * allowed to do and a reusable building block is not.
 *
 * It lived at `core/config.ts` until it was moved here, where SvelteKit's own
 * `$lib` convention already expected it.
 */
import {version} from '$app/environment';
import {createServiceWorker} from './core/service-worker';
import {createNotificationsService} from './core/notifications';
import {
	getHashParamsFromLocation,
	getParamsFromLocation,
} from './core/utils/web/url';
import {createRouteHandler, resolvePath} from './kit/paths';
import {openFromNotification} from './kit/notification-navigation';

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
