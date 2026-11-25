import {test, expect, type BrowserContext, type Page} from '@playwright/test';
import {PLAIN_URL} from '../ports';

/**
 * A click on a notification, against the real worker in a real browser (QA
 * F19): it must not reload a tab already open, and the app must see the
 * notification's data.
 *
 * The unit tests pin the choice of tab, the ack and the page's routing
 * (`test/service-worker/push.test.ts`, `test/lib/core/service-worker/
 * messages.test.ts`). These pin the wiring: the worker's `notificationclick`
 * handler reaching the page's listener and back, through a real port.
 *
 * Playwright cannot click a system notification, and its headless shell
 * denies notifications whatever the context grants (so the worker cannot even
 * show one), so a `notificationclick` carrying a stand-in notification (its
 * `data` and `close`) is dispatched inside the worker. The handler is the real
 * one; the only differences from a user's click are that a dispatched event is
 * untrusted, so its `waitUntil` throws (the handler starts before it, see
 * `src/service-worker/index.ts`), and focusing is refused.
 */

async function controlledPage(context: BrowserContext): Promise<Page> {
	const page = await context.newPage();
	await page.goto(`${PLAIN_URL}/`);
	await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
		timeout: 20_000,
	});
	// a reload would drop this
	await page.evaluate(() => ((globalThis as any).__notReloaded = true));
	return page;
}

/** Click a notification carrying `data`, inside the worker. */
async function clickNotification(
	context: BrowserContext,
	data: Record<string, unknown>,
) {
	const worker =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent('serviceworker'));
	await worker.evaluate((data) => {
		const event = new Event('notificationclick');
		Object.defineProperty(event, 'notification', {
			value: {data, close() {}},
		});
		self.dispatchEvent(event);
	}, data);
}

const lastClick = (page: Page) =>
	page.evaluate(() => {
		const g = globalThis as any;
		return g.get(g.serviceWorker.notificationClicks);
	});

const notReloaded = (page: Page) =>
	page.evaluate(() => (globalThis as any).__notReloaded === true);

test('a click routes the open tab in place and hands the app its data', async ({
	context,
}) => {
	const page = await controlledPage(context);

	await clickNotification(context, {navigate: '?from=push', id: 7});

	await expect.poll(() => page.url()).toBe(`${PLAIN_URL}/?from=push`);
	await expect
		.poll(() => lastClick(page))
		.toMatchObject({
			url: `${PLAIN_URL}/?from=push`,
			data: {navigate: '?from=push', id: 7},
		});
	expect(await notReloaded(page)).toBe(true);
});

test('a click on the page already shown does not reload it', async ({
	context,
}) => {
	const page = await controlledPage(context);

	await clickNotification(context, {navigate: '', id: 1});
	await clickNotification(context, {navigate: '/', id: 2});

	await expect.poll(() => lastClick(page)).toMatchObject({data: {id: 2}});
	expect(page.url()).toBe(`${PLAIN_URL}/`);
	expect(await notReloaded(page)).toBe(true);
});

test('a tab that does not take the click (an older build) is navigated by the worker', async ({
	context,
}) => {
	const page = await controlledPage(context);
	// stop listening, as a page from before the click contract does
	await page.evaluate(() => (globalThis as any).serviceWorker.cleanup());

	await clickNotification(context, {navigate: '?from=old'});

	await expect
		.poll(() => page.url(), {timeout: 10_000})
		.toBe(`${PLAIN_URL}/?from=old`);
	await page.waitForLoadState();
	expect(await notReloaded(page)).toBe(false);
});
