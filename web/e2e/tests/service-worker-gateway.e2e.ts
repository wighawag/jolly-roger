import {test, expect, type Page} from '@playwright/test';
import {PLAIN_URL, SW_GATEWAY_URL} from '../ports';

/**
 * The service worker registration decision, against real hosts in a real
 * browser.
 *
 * The unit tests in `test/lib/core/service-worker/scope.test.ts` pin the RULE.
 * These pin the WIRING: that the rule is reached with the values the browser
 * actually supplies, which is the part string logic cannot prove.
 */

/**
 * NOTE ON WAITING FOR SERVICE WORKER STATE
 *
 * Do NOT use `page.waitForFunction(async () => ...)` here. It does not await an
 * async predicate, so the returned Promise is truthy on the first poll and the
 * wait returns IMMEDIATELY. Everything about service worker state
 * (`getRegistrations()`, and reads that follow registration) is async, so that
 * mistake turns a wait into a no-op and leaves a test that passes or fails on
 * timing. It did exactly that here.
 *
 * `expect.poll()` awaits the function it is given, so it both waits and
 * asserts. Use it, or poll inside a single `page.evaluate`.
 */

/** Every service worker script URL currently registered for this origin. */
async function registeredScriptURLs(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const registrations = await navigator.serviceWorker.getRegistrations();
		return registrations.map(
			(r) =>
				r.active?.scriptURL ??
				r.waiting?.scriptURL ??
				r.installing?.scriptURL ??
				'',
		);
	});
}

/**
 * What the app itself decided, as recorded in its own store. Read through the
 * `get` and `serviceWorker` handles `+layout.ts` attaches for console access.
 */
async function serviceWorkerState(page: Page) {
	return page.evaluate(() => {
		const g = globalThis as any;
		return g.get && g.serviceWorker ? g.get(g.serviceWorker) : undefined;
	});
}

test('registers its own worker on an ordinary static host', async ({page}) => {
	await page.goto(`${PLAIN_URL}/`);

	await expect
		.poll(
			async () =>
				(await registeredScriptURLs(page)).some((u) =>
					u.endsWith('/service-worker.js'),
				),
			{timeout: 20_000},
		)
		.toBe(true);
});

test('does not register when a gateway worker already covers the scope', async ({
	page,
}) => {
	// First load is the gateway's bootstrap page, which installs ITS worker at
	// scope `/`. Our app is not running yet at this point.
	await page.goto(`${SW_GATEWAY_URL}/`);
	await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
		timeout: 20_000,
	});

	// Now the gateway worker serves the real site, so this load is OUR app,
	// controlled by a foreign worker: the situation the guard exists for.
	await page.goto(`${SW_GATEWAY_URL}/`);
	// Wait on the DECISION rather than on a fixed delay: the app reaching a
	// `skipped` state is the signal that registration was considered and
	// declined. This asserts it too, and asserts the RIGHT reason: had it tried
	// and failed, the state would be `error`, which is the same end state by
	// accident and would hide the guard silently regressing.
	await expect
		.poll(async () => (await serviceWorkerState(page))?.skipped ?? null, {
			timeout: 20_000,
		})
		.toBe('foreign-scope-owner');

	const scripts = await registeredScriptURLs(page);

	// The gateway's worker is still the one in charge...
	expect(scripts.some((u) => u.includes('sw.js'))).toBe(true);
	// ...and we did not add ours alongside it.
	expect(scripts.some((u) => u.endsWith('/service-worker.js'))).toBe(false);
});
