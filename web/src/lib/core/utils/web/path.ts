import {resolve} from '$app/paths';
import {getParamsFromURL, queryStringifyNoArray} from './url.js';

/**
 * Dynamic route pattern definition
 * - pattern: Regex that captures (basePath)(dynamicValue) - must have 2 capture groups
 * - basePath: The static base path for hash-based URL conversion
 */
export type DynamicRoutePattern = {
	pattern: RegExp;
	basePath: string;
};

/**
 * Options for createRouteHandler
 */
export type RouteHandlerOptions<T extends readonly string[]> = {
	/** Global query parameters to preserve across routes */
	globalQueryParams: T;
	/** Dynamic route patterns for IPFS compatibility */
	dynamicRoutes?: DynamicRoutePattern[];
};

/**
 * Check if we're on a path-based IPFS gateway (non-unique origin)
 * These gateways don't support _redirects, so dynamic routes need hash-based URLs
 */
export function isPathBasedIPFS(): boolean {
	if (typeof window === 'undefined') return false;
	const path = window.location.pathname;
	return path.startsWith('/ipfs/') || path.startsWith('/ipns/');
}

/** `https://…`, `//cdn…`, `mailto:…`: nothing for us to resolve or decorate. */
function isExternal(p: string): boolean {
	return p.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(p);
}

/**
 * An app-absolute path (`/blog/`). These are the ones `resolve()` understands:
 * it rewrites them against `paths.base` (and makes them relative when
 * `paths.relative` is set, which is what keeps a build IPFS-portable).
 */
function isAppAbsolute(p: string): boolean {
	return p.startsWith('/') && !p.startsWith('//');
}

/** Split `/a/b?x=1#frag` into its path, query and hash parts. */
function splitPath(p: string): {path: string; query: string; hash: string} {
	let path = p;
	let hash = '';
	let query = '';
	const h = path.indexOf('#');
	if (h !== -1) {
		hash = path.slice(h);
		path = path.slice(0, h);
	}
	const q = path.indexOf('?');
	if (q !== -1) {
		query = path.slice(q);
		path = path.slice(0, q);
	}
	return {path, query, hash};
}

export function createRouteHandler<T extends readonly string[]>(
	params: Record<string, string>,
	options: RouteHandlerOptions<T>,
) {
	const {globalQueryParams, dynamicRoutes = []} = options;

	/**
	 * Convert a path to hash-based URL if it matches a dynamic route pattern
	 * e.g., /explorer/tx/0x123 -> /explorer/tx/#0x123
	 */
	function convertToDynamicUrl(path: string): string {
		for (const {pattern, basePath} of dynamicRoutes) {
			const match = path.match(pattern);
			if (match && match[2]) {
				// Found a dynamic route - use hash-based URL for path-based IPFS
				return `${basePath}#${match[2]}`;
			}
		}
		return path;
	}

	/**
	 * Generate a route path, preserving the global query params and handling
	 * dynamic routes for IPFS compatibility.
	 *
	 * BOTH path styles are accepted:
	 *   - app-absolute (`/blog/`)  -> run through `resolve()`, so it is rewritten
	 *     against `paths.base` and made relative when `paths.relative` is set.
	 *   - relative (`./`, `../`, `blog/`) -> passed through as-is. A relative URL
	 *     already resolves against the current document, which is exactly the
	 *     base-independence `resolve()` buys for absolute ones, so it is already
	 *     IPFS-safe. `resolve()` THROWS on non-absolute input, so it must be
	 *     skipped here.
	 * External URLs are returned untouched.
	 *
	 * @param p - The path to resolve
	 * @param hash - Optional hash to append (ignored if `p` already carries one)
	 */
	function route(p: string, hash?: string) {
		if (isExternal(p)) {
			return p;
		}

		let input = p;

		// On path-based IPFS, rewrite dynamic routes to hash-based URLs. Only
		// app-absolute paths are matched, since the patterns are anchored at `/`.
		if (
			typeof window !== 'undefined' &&
			isPathBasedIPFS() &&
			dynamicRoutes.length > 0
		) {
			input = convertToDynamicUrl(input);
		}

		const {path: bare, query, hash: inlineHash} = splitPath(input);

		let path = bare;
		if (!path.endsWith('/')) {
			path += '/';
		}

		// Keep any query already on `p`, and merge in the global params.
		const queryString = getQueryStringToKeep(`${path}${query}`);

		const explicitHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
		// Query must come BEFORE the fragment, otherwise it is swallowed by it.
		const out = `${path}${queryString}${inlineHash || explicitHash}`;

		return isAppAbsolute(bare) ? resolve<any>(out) : out;
	}

	function getQueryStringToKeep(p: string): string {
		if (globalQueryParams && globalQueryParams.length > 0) {
			const {params: paramFromPath} = getParamsFromURL(p);
			for (const queryParam of globalQueryParams) {
				if (
					typeof params[queryParam] != 'undefined' &&
					typeof paramFromPath[queryParam] === 'undefined'
				) {
					paramFromPath[queryParam] = params[queryParam];
				}
			}
			return queryStringifyNoArray(paramFromPath);
		} else {
			return '';
		}
	}

	function isSameRoute(a: string, b: string): boolean {
		return a === b || a === route(b);
	}

	function isParentRoute(a: string, b: string): boolean {
		return a.startsWith(b) || a.startsWith(route(b));
	}

	return {
		route,
		isSameRoute,
		isParentRoute,
		params: params as Record<T[number], string | undefined>,
	};
}

/**
 * Generate a URL for static resources (images, etc.)
 * Use `route()` for navigation paths instead.
 *
 * @param p - The path to resolve
 * @param hash - Optional hash to append
 */
export function url(p: string, hash?: string) {
	return resolve<any>(
		hash ? `${p}${hash.startsWith('#') ? hash : `#${hash}`}` : p,
	);
}
