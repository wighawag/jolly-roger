/**
 * Where this app is composed.
 *
 * Everything under `core/` is written to not know which app it is running in,
 * so somebody has to hand the pieces to each other and supply the framework's
 * answers. That is this file, and keeping it OUT of `core/` is what lets the
 * rule in `test/framework-boundary.test.ts` be true: a composition root may
 * import `./kit/*` and the environment, and a reusable building block may not.
 *
 * At the root template this file lived at `core/config.ts` until it was moved
 * here; this repo made the same move in 91ef28b, five hundred commits earlier.
 */
import {createRouteHandler} from './kit/paths';
import {
	getHashParamsFromLocation,
	getParamsFromLocation,
} from './core/utils/web/url';

import {createServiceWorker} from '$lib/core/service-worker';
import {resolvePath} from './kit/paths';
import {openFromNotification} from './kit/notification-navigation';
import {createNotificationsService} from './core/notifications';
import {createContext} from 'svelte';
import type {Context} from './context/types';
import {env} from '$env/dynamic/public';

export const hashParams = getHashParamsFromLocation();

const {params: paramFromLocation} = getParamsFromLocation();
export const {isParentRoute, isSameRoute, route, params} = createRouteHandler(
	paramFromLocation,
	{
		globalQueryParams: [
			'dev',
			'transactions',
			'debug',
			'debugLevel',
			'traceLevel',
			'debugLabel',
			'eruda',
			'tx-observer',
			'burner',
		] as const,
		// Dynamic routes that need hash-based URLs on path-based IPFS gateways
		dynamicRoutes: [
			{
				pattern: /^(\/explorer\/tx\/)(0x[a-fA-F0-9]+)\/?$/,
				basePath: '/explorer/tx/',
			},
			{
				pattern: /^(\/explorer\/address\/)(0x[a-fA-F0-9]+)\/?$/,
				basePath: '/explorer/address/',
			},
		],
	},
);

export const dev = params.dev || import.meta.env.DEV;

// Runtime override for the burner wallet (see context/burner.ts). Preserved
// across navigation because `burner` is a global query param above.
export {parseBurnerParam} from './context/burner';
import {parseBurnerParam as _parseBurnerParam} from './context/burner';
export const burnerOverride = _parseBurnerParam(params.burner);

/**
 * MODULE SCOPE, deliberately, and the reason is ordering rather than taste.
 *
 * There is exactly one service worker registration per page, and it has to be
 * claimed EARLY: `routes/+layout.ts` registers it from module scope, because a
 * controlling worker's queued messages are flushed right after
 * `DOMContentLoaded` and a registration that waits for the app context to be
 * built would miss them (see the comment there). A per-context instance could
 * not exist yet at that moment.
 *
 * The same goes for notifications, which the worker feeds.
 *
 * This is NOT a licence for module-level state in general. The test is whether
 * the thing is genuinely process-scoped, like a browser registration, or
 * whether it belongs to a session, an account or a page, in which case it goes
 * in the app context and dies with it. ADR-0004 (`work` branch) records what
 * the second kind costs when it gets this wrong.
 */
export const notifications = createNotificationsService();
export const serviceWorker = createServiceWorker(
	{resolvePath, navigateTo: openFromNotification},
	notifications,
);

const [getAppContextFunction, setAppContext] = createContext<() => Context>();

const getAppContext = () => getAppContextFunction()();
export {getAppContext, setAppContext};

// Dev/debug: attaching to globalThis for console access
(globalThis as any).env = env;
// Dev/debug: attaching to globalThis for console access
(globalThis as any).vite_env = import.meta.env;

// HMR cleanup: Remove service worker listeners when module is hot-replaced in dev
// This prevents listener accumulation during development
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		serviceWorker.cleanup();
	});
}
