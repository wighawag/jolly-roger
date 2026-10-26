// The network step every caching strategy in the worker shares: fetch, keep
// the cache current, and fall back to the cached copy when the network fails.
//
// It takes `fetch` and the cache write as parameters so it can be tested
// without a service worker runtime (see test/service-worker/).

export type FetchAndUpdateCacheDependencies = {
	fetch: (request: Request) => Promise<Response>;
	put: (request: Request, response: Response) => Promise<void>;
	log?: (...args: unknown[]) => void;
};

// Only a response we would be happy to serve again may enter the cache. A
// transient HTTP error (a 503 during a deploy, a 404 from a half-propagated
// CDN) must never replace a working copy: a cache-first asset is refreshed in
// the background, so the error would silently land in the cache and be served
// on the next offline load, breaking the app.
//
// Opaque responses (cross-origin `no-cors`, e.g. a CDN image) hide their
// status, so they cannot be told apart from an error. They are still cached,
// as they always were, because refusing them would mean never caching
// cross-origin assets at all.
function isCacheable(response: Response): boolean {
	return response.ok || response.type === 'opaque';
}

export function createFetchAndUpdateCache(
	dependencies: FetchAndUpdateCacheDependencies,
) {
	const {fetch, put, log = () => {}} = dependencies;

	// `keepAlive` is the fetch event's `waitUntil`: the cache write is not
	// awaited, and without it the browser may stop the worker mid-write.
	return async function fetchAndUpdateCache(
		request: Request,
		cached?: Response,
		keepAlive?: (promise: Promise<unknown>) => void,
	): Promise<Response> {
		let response: Response;
		try {
			response = await fetch(request);
		} catch (err) {
			log(`fetch failed: ${err}`);
			return (
				cached ??
				new Response(`Could Not fetch ${request.url}`, {
					status: 503,
					headers: {'Content-Type': 'text/plain'},
				})
			);
		}

		if (!isCacheable(response)) {
			log(`not caching ${request.url}: HTTP ${response.status}`);
			// a known-good copy beats an error the server may recover from
			return cached ?? response;
		}

		// only on http(s), so chrome-extension:// requests do not error out
		if (request.method === 'GET' && request.url.startsWith('http')) {
			// not awaited: the page should not wait for the body to be stored
			const write = put(request, response.clone()).catch((err) =>
				log(`error: ${err}`),
			);
			try {
				keepAlive?.(write);
			} catch (err) {
				// waitUntil throws once the event is over; the write still runs
				log(`keepAlive: ${err}`);
			}
		}
		return response;
	};
}
