import {defineCapability} from './define';

/**
 * Resolves an app path to a URL. The app root provides its configured resolver
 * so links honour global query-param preservation and IPFS dynamic-route
 * handling.
 */
export type RouteResolver = (path: string, hash?: string) => string;

/**
 * The route capability.
 *
 * The fallback passes the path through unchanged, which is the honest answer
 * when nobody has said where the app is deployed: base paths, IPFS-relative
 * rewriting, query preservation and dynamic-route hashing are all things the
 * app root knows and a standalone component does not. Every app in this
 * template provides the real resolver at the root (see routes/+layout.svelte),
 * so the fallback only ever applies to a component rendered in isolation, such
 * as in a component test.
 */
const routeCapability = defineCapability<RouteResolver>('route', {
	fallback: (): RouteResolver => (path, hash) =>
		hash ? `${path}${hash.startsWith('#') ? hash : `#${hash}`}` : path,
});

export const provideRoute = routeCapability.provide;
export const useRoute = routeCapability.use;
