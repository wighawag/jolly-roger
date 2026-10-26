import {describe, it, expect, vi} from 'vitest';
import {createFetchAndUpdateCache} from '../../src/service-worker/fetch-and-update-cache';

const URL = 'https://example.com/_app/immutable/entry/app.js';

function setup(fetchImpl: (request: Request) => Promise<Response>) {
	const put = vi.fn(async (_request: Request, _response: Response) => {});
	const fetchAndUpdateCache = createFetchAndUpdateCache({
		fetch: fetchImpl,
		put,
	});
	return {fetchAndUpdateCache, put};
}

function cachedScript() {
	return new Response('console.log("app")', {
		status: 200,
		headers: {'Content-Type': 'text/javascript'},
	});
}

describe('fetchAndUpdateCache', () => {
	it('caches and returns a successful response', async () => {
		const {fetchAndUpdateCache, put} = setup(
			async () => new Response('fresh', {status: 200}),
		);
		const response = await fetchAndUpdateCache(new Request(URL));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('fresh');
		expect(put).toHaveBeenCalledTimes(1);
		expect(await put.mock.calls[0][1].text()).toBe('fresh');
	});

	it('never lets an HTTP error overwrite the cached copy', async () => {
		// the reported bug: a background refresh hit a transient 503, the error
		// replaced the working script, and the next offline reload served it
		const {fetchAndUpdateCache, put} = setup(
			async () => new Response('Service Unavailable', {status: 503}),
		);
		await fetchAndUpdateCache(new Request(URL), cachedScript());
		expect(put).not.toHaveBeenCalled();
	});

	it('serves the cached copy instead of an HTTP error when it has one', async () => {
		const {fetchAndUpdateCache} = setup(
			async () => new Response('Service Unavailable', {status: 503}),
		);
		const response = await fetchAndUpdateCache(
			new Request(URL),
			cachedScript(),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('console.log("app")');
	});

	it('passes an HTTP error through, uncached, when nothing is cached', async () => {
		const {fetchAndUpdateCache, put} = setup(
			async () => new Response('Not Found', {status: 404}),
		);
		const response = await fetchAndUpdateCache(new Request(URL));
		expect(response.status).toBe(404);
		expect(put).not.toHaveBeenCalled();
	});

	it('serves the cached copy when the network is unreachable', async () => {
		const {fetchAndUpdateCache, put} = setup(async () => {
			throw new TypeError('Failed to fetch');
		});
		const response = await fetchAndUpdateCache(
			new Request(URL),
			cachedScript(),
		);
		expect(response.status).toBe(200);
		expect(put).not.toHaveBeenCalled();
	});

	it('answers 503 when the network is unreachable and nothing is cached', async () => {
		const {fetchAndUpdateCache} = setup(async () => {
			throw new TypeError('Failed to fetch');
		});
		const response = await fetchAndUpdateCache(new Request(URL));
		expect(response.status).toBe(503);
	});

	it('does not cache non-GET requests', async () => {
		const {fetchAndUpdateCache, put} = setup(
			async () => new Response('ok', {status: 200}),
		);
		await fetchAndUpdateCache(new Request(URL, {method: 'POST'}));
		expect(put).not.toHaveBeenCalled();
	});

	it('does not cache non-http(s) requests', async () => {
		const {fetchAndUpdateCache, put} = setup(
			async () => new Response('ok', {status: 200}),
		);
		// a stand-in for chrome-extension://, which Cache.put rejects
		await fetchAndUpdateCache({
			method: 'GET',
			url: 'chrome-extension://abc/script.js',
		} as Request);
		expect(put).not.toHaveBeenCalled();
	});

	it('hands the pending cache write to keepAlive', async () => {
		// a cache-first refresh outlives respondWith(), so the worker must be
		// told to stay up until the write lands
		let finishWrite!: () => void;
		const put = vi.fn(
			() => new Promise<void>((resolve) => (finishWrite = resolve)),
		);
		const fetchAndUpdateCache = createFetchAndUpdateCache({
			fetch: async () => new Response('fresh', {status: 200}),
			put,
		});
		const kept: Promise<unknown>[] = [];
		await fetchAndUpdateCache(new Request(URL), undefined, (p) => kept.push(p));
		expect(kept).toHaveLength(1);
		let settled = false;
		kept[0].then(() => (settled = true));
		await Promise.resolve();
		expect(settled).toBe(false);
		finishWrite();
		await kept[0];
		expect(settled).toBe(true);
	});

	it('survives a keepAlive that throws', async () => {
		// waitUntil throws InvalidStateError once the event has finished
		const {fetchAndUpdateCache} = setup(
			async () => new Response('fresh', {status: 200}),
		);
		const response = await fetchAndUpdateCache(
			new Request(URL),
			undefined,
			() => {
				throw new Error('InvalidStateError');
			},
		);
		expect(await response.text()).toBe('fresh');
	});

	it('still returns the response when writing to the cache fails', async () => {
		const put = vi.fn(async () => {
			throw new Error('QuotaExceededError');
		});
		const fetchAndUpdateCache = createFetchAndUpdateCache({
			fetch: async () => new Response('fresh', {status: 200}),
			put,
		});
		const response = await fetchAndUpdateCache(new Request(URL));
		expect(await response.text()).toBe('fresh');
	});
});
