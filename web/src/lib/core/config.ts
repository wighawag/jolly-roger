import {version} from '$app/environment';
import {createServiceWorker} from './service-worker';
import {
	getHashParamsFromLocation,
	getParamsFromLocation,
} from './utils/web/url';
import {createRouteHandler} from './utils/web/path';

export const serviceWorker = createServiceWorker();

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
