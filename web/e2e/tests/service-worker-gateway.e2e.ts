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

	await page.waitForFunction(
		async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
		null,
		{timeout: 20_000},
	);

	const scripts = await registeredScriptURLs(page);
	expect(scripts.some((u) => u.endsWith('/service-worker.js'))).toBe(true);
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
	await page.waitForFunction(() => !!(globalThis as any).serviceWorker, null, {
		timeout: 20_000,
	});
	// give registration, had it been attempted, time to land either way
	await page.waitForTimeout(2000);

	const scripts = await registeredScriptURLs(page);

	// The gateway's worker is still the one in charge...
	expect(scripts.some((u) => u.includes('sw.js'))).toBe(true);
	// ...and we did not add ours alongside it.
	expect(scripts.some((u) => u.endsWith('/service-worker.js'))).toBe(false);

	// And we skipped DELIBERATELY, rather than having tried and failed: a failed
	// registration would leave `error` set instead, which is the same end state
	// by accident and would hide the guard silently regressing.
	const state = await serviceWorkerState(page);
	expect(state?.skipped).toBe('foreign-scope-owner');
});
