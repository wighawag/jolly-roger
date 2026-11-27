import {test, expect, type BrowserContext, type Page} from '@playwright/test';
import {PLAIN_URL} from '../ports';

/**
 * A push's hand-off in its URL (`#push-handoff=...`, QA F23), in a real
 * browser against the real build: what the page does where the worker never
 * runs (Safari's Declarative Web Push loads the notification's `navigate`),
 * and what it does with a worker click that carries one.
 *
 * The format, the clicks and the routing are pinned by
 * `test/lib/core/service-worker/push-handoff.test.ts`; these pin the wiring:
 * `src/hooks.client.ts` reading it before the app does, and the hand-off
 * published as a click in `serviceWorker.notificationClicks`.
 */

// built like missiv's: base64url without padding of the JSON
function withHandoff(url: string, handoff: object): string {
	const segment = `push-handoff=${Buffer.from(JSON.stringify(handoff)).toString('base64url')}`;
	return url.includes('#') ? `${url}&${segment}` : `${url}#${segment}`;
}

const HANDOFF = {
	missiv: {
		type: 'message',
		namespace: 'e2e',
		conversationID: '0xconv',
		recipient: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
	},
};

const lastClick = (page: Page) =>
	page.evaluate(() => {
		const g = globalThis as any;
		return g.get && g.serviceWorker
			? g.get(g.serviceWorker.notificationClicks)
			: 'not loaded';
	});

async function controlledPage(
	context: BrowserContext,
	path = '/',
): Promise<Page> {
	const page = await context.newPage();
	await page.goto(`${PLAIN_URL}${path}`);
	await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
		timeout: 20_000,
	});
	await page.evaluate(() => ((globalThis as any).__notReloaded = true));
	return page;
}

const notReloaded = (page: Page) =>
	page.evaluate(() => (globalThis as any).__notReloaded === true);

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

test('a page loaded on a hand-off reads it, removes it from the URL and publishes it', async ({
	page,
}) => {
	await page.goto(withHandoff(`${PLAIN_URL}/?a=1#b=2`, HANDOFF));

	await expect
		.poll(() => lastClick(page))
		.toMatchObject({id: 1, url: `${PLAIN_URL}/?a=1#b=2`, data: HANDOFF});
	expect(page.url()).toBe(`${PLAIN_URL}/?a=1#b=2`);
	// a reload does not replay it
	await page.reload();
	await expect.poll(() => lastClick(page)).toBeUndefined();
	expect(page.url()).toBe(`${PLAIN_URL}/?a=1#b=2`);
});

test('a hand-off reaching an open tab by a fragment navigation is read in place', async ({
	context,
}) => {
	const page = await controlledPage(context);

	await page.evaluate(
		(url) => (location.href = url),
		withHandoff(`${PLAIN_URL}/`, HANDOFF),
	);

	await expect.poll(() => lastClick(page)).toMatchObject({data: HANDOFF});
	expect(page.url()).toBe(`${PLAIN_URL}/`);
	expect(await notReloaded(page)).toBe(true);
});

test("a worker click on the root's hand-off URL does not leave it in the address bar", async ({
	context,
}) => {
	const page = await controlledPage(context, '/?from=elsewhere');
	const navigate = withHandoff(`${PLAIN_URL}/`, HANDOFF);

	await clickNotification(context, {missiv: HANDOFF.missiv, navigate});

	await expect.poll(() => page.url()).toBe(`${PLAIN_URL}/`);
	await expect
		.poll(() => lastClick(page))
		.toMatchObject({
			id: 1,
			url: `${PLAIN_URL}/`,
			data: {missiv: HANDOFF.missiv},
		});
	expect(await notReloaded(page)).toBe(true);

	// and from the root, it stays there
	await clickNotification(context, {missiv: HANDOFF.missiv, navigate});
	await expect.poll(async () => (await lastClick(page))?.id).toBe(2);
	expect(page.url()).toBe(`${PLAIN_URL}/`);
	expect(await notReloaded(page)).toBe(true);
});
