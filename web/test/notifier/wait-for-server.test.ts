// QA F12: the trigger service started polling the indexer's feed before the
// indexer (another pane) listened, so each `pnpm start` opened with an error.
import {describe, expect, it, vi} from 'vitest';
import {waitForServer} from '../../notifier/wait-for-server';

describe('waitForServer (the trigger service waits for the indexer)', () => {
	it('retries until the server answers, saying once that it waits', async () => {
		let calls = 0;
		const fetch = vi.fn(async () => {
			if (++calls < 3) throw new TypeError('fetch failed');
			return new Response('not found', {status: 404});
		}) as unknown as typeof globalThis.fetch;
		const log = vi.fn();
		const ok = await waitForServer('http://indexer.invalid/', 'the indexer', {
			fetch,
			log,
			intervalMs: 1,
		});
		expect(ok).toBe(true);
		expect(calls).toBe(3);
		expect(log.mock.calls.map(([line]) => line)).toEqual([
			'waiting for the indexer on http://indexer.invalid/ ...',
			'the indexer answers on http://indexer.invalid/',
		]);
	});

	it('says nothing when the server already answers', async () => {
		const log = vi.fn();
		const fetch = (async () =>
			new Response('ok')) as unknown as typeof globalThis.fetch;
		expect(
			await waitForServer('http://indexer.invalid/', 'the indexer', {
				fetch,
				log,
			}),
		).toBe(true);
		expect(log).not.toHaveBeenCalled();
	});

	it('gives up when stopped', async () => {
		const controller = new AbortController();
		const fetch = (async () => {
			controller.abort();
			throw new TypeError('fetch failed');
		}) as unknown as typeof globalThis.fetch;
		expect(
			await waitForServer('http://indexer.invalid/', 'the indexer', {
				fetch,
				log: () => {},
				intervalMs: 1,
				signal: controller.signal,
			}),
		).toBe(false);
	});

	it('is what the trigger service does before it reads the feed', async () => {
		const {readFileSync} = await import('node:fs');
		const serve = readFileSync(
			new URL('../../notifier/serve.ts', import.meta.url),
			'utf8',
		);
		const triggers = serve.slice(serve.indexOf('async function serveTriggers'));
		expect(triggers.indexOf('waitForServer(')).toBeGreaterThan(-1);
		expect(triggers.indexOf('waitForServer(')).toBeLessThan(
			triggers.indexOf('createNodeService('),
		);
	});
});
