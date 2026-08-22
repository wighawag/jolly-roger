import {resolve} from '$app/paths';
import {
	createRouteHandler as createPortableRouteHandler,
	urlWith,
	type PathResolver,
	type RouteHandlerOptions,
} from '$lib/core/utils/web/path';

/**
 * SvelteKit's answer to "where is this app actually deployed".
 *
 * `resolve()` rewrites an app-absolute path against `paths.base`, and makes it
 * relative when `paths.relative` is set, which is what keeps a build portable
 * to IPFS. The rest of the app takes this as a {@link PathResolver} so nothing
 * outside this directory has to know that (see ./README.md).
 */
export const resolvePath: PathResolver = (path) =>
	// `resolve()` is generic over SvelteKit's generated route ids, and these paths
	// are plain strings: built at runtime, or pointing at static assets that are
	// not routes at all. The `any` is the same one this code has always carried.
	resolve<any>(path);

/** {@link urlWith}, pre-bound to this deployment. For static assets. */
export function url(path: string, hash?: string): string {
	return urlWith(resolvePath, path, hash);
}

/** {@link createPortableRouteHandler}, pre-bound to this deployment. */
export function createRouteHandler<T extends readonly string[]>(
	params: Record<string, string>,
	options: Omit<RouteHandlerOptions<T>, 'resolvePath'>,
) {
	return createPortableRouteHandler(params, {...options, resolvePath});
}
