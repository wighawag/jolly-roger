import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';

/**
 * The height contract `+layout.svelte` states, measured in a real browser
 * because every part of it is a used value: percentage resolution, flex
 * leftover space, and what the viewport says it is.
 *
 * WHAT IS BEING PINNED, in one sentence: the content region is exactly what the
 * chrome leaves, so a bar appearing SHRINKS the page instead of pushing it past
 * the fold. The bug it replaces was silent - an app that asked for a
 * viewport-tall surface got one, plus a navbar, and overflowed by the height of
 * the navbar - and it was silent in the TEMPLATE, so every descendant inherited
 * it armed.
 */
describe('The layout height shell', () => {
	/** The region the page is rendered into, named by the layout. */
	const contentOf = (page: Page) => page.locator('[data-app-content]');

	/**
	 * Boxes as the browser resolved them, plus the two viewport facts the
	 * assertions are made against. One evaluate, so nothing can change between
	 * the measurements.
	 */
	async function geometry(page: Page) {
		return page.evaluate(() => {
			const rect = (selector: string) => {
				const el = document.querySelector(selector);
				return el ? el.getBoundingClientRect() : undefined;
			};
			const doc = document.documentElement;
			return {
				nav: rect('nav'),
				content: rect('[data-app-content]'),
				viewportHeight: window.innerHeight,
				documentScrolls: doc.scrollHeight > doc.clientHeight,
			};
		});
	}

	/**
	 * What a descendant actually writes: `h-full` on something inside the page.
	 * Measured by putting one there, rather than by trusting that a computed
	 * height means what it looks like - the whole failure mode this guards
	 * against is a percentage that silently resolves against the wrong box.
	 */
	async function heightOfAFullHeightChild(page: Page) {
		return page.evaluate(() => {
			const region = document.querySelector('[data-app-content]');
			if (!region) return undefined;
			const probe = document.createElement('div');
			probe.className = 'h-full';
			region.appendChild(probe);
			const height = probe.getBoundingClientRect().height;
			probe.remove();
			return height;
		});
	}

	test('the content region is exactly what the chrome leaves', async ({
		page,
	}) => {
		await page.goto('/');

		const {nav, content, viewportHeight} = await geometry(page);

		expect(nav, 'the navbar is the chrome being measured').toBeTruthy();
		expect(content, 'the layout renders a content region').toBeTruthy();

		// It starts where the chrome ends and finishes at the fold. Both halves
		// matter: the first says the chrome was not painted over, the second says
		// the page was not pushed under.
		expect(Math.round(content!.top)).toBe(Math.round(nav!.bottom));
		expect(Math.round(content!.bottom)).toBe(viewportHeight);

		// And that is what `h-full` inside it means. Before the shell this
		// resolved against nothing useful and apps reached for `h-screen`, which
		// is the viewport INCLUDING the chrome that is sitting above it.
		expect(await heightOfAFullHeightChild(page)).toBeCloseTo(
			content!.height,
			1,
		);
	});

	test('the navbar survives a page that out-scrolls what a sticky one could reach', async ({
		page,
	}) => {
		// A sticky element stays pinned only while its containing block is on
		// screen, and the shell is exactly `100dvh`, so a sticky navbar's travel is
		// `100dvh - var(--navbar-height)`. The trigger is therefore NOT "a long
		// page": it is a page taller than roughly two viewports, which a laptop
		// window at half height or a phone in landscape reaches on the HOME page,
		// the shortest one there is. That is why the navbar is `fixed`.
		await page.setViewportSize({width: 1280, height: 348});
		await page.goto('/');

		const {nav, viewportHeight} = await geometry(page);
		const maxScroll = await page.evaluate(() => {
			const doc = document.documentElement;
			return doc.scrollHeight - doc.clientHeight;
		});

		// THE PRECONDITION, asserted rather than assumed. If the home page ever
		// stops scrolling this far, the assertion below still passes while proving
		// nothing, and the bug walks back in silently. That is exactly how it got
		// in: the suite runs at 720 tall by default, where nothing comes close.
		expect(
			maxScroll,
			'the page has to out-scroll a sticky navbar, or this test proves nothing',
		).toBeGreaterThan(viewportHeight - nav!.height);

		await page.evaluate(() =>
			window.scrollTo(0, document.documentElement.scrollHeight),
		);

		// Still at the top of the viewport, at the very bottom of the document.
		await expect
			.poll(async () => Math.round((await geometry(page)).nav!.top), {
				message: 'the navbar is still pinned at the bottom of the scroll',
			})
			.toBe(0);
	});

	test('a durable-condition bar shrinks the page instead of pushing it down', async ({
		page,
	}) => {
		await page.goto('/');
		const before = await geometry(page);

		// The offline bar is the honest trigger: `core/connection/offline.ts`
		// listens for the browser's own event, so this is the condition arriving
		// the way it arrives for a user, not a class toggled in a test.
		//
		// `page.context()` rather than the `context` fixture: e2e/fixtures/test.ts
		// builds its OWN context inside the `page` fixture, so the injected one
		// belongs to a different browser context and taking it offline leaves this
		// page perfectly online - which is how this test first failed.
		await page.context().setOffline(true);
		const banner = page.getByTestId('offline-banner');
		await expect(banner).toBeVisible();

		const after = await geometry(page);
		const bannerHeight = (await banner.boundingBox())!.height;

		// The page got SHORTER by the height of the bar, and its bottom did not
		// move: nothing went under the fold, which is the bug in one assertion.
		expect(Math.round(after.content!.bottom)).toBe(after.viewportHeight);
		expect(
			Math.abs(before.content!.height - after.content!.height - bannerHeight),
			'the region gives up exactly the bar, no more and no less',
		).toBeLessThanOrEqual(1);

		// The bar is chrome, so it sits below the navbar rather than over it, and
		// the navbar keeps its height (`[&>*]:shrink-0`).
		expect(Math.round(after.nav!.height)).toBe(Math.round(before.nav!.height));
		expect(Math.round(after.content!.top)).toBe(
			Math.round(after.nav!.bottom + bannerHeight),
		);

		// And `h-full` still means the region, which is now smaller.
		expect(await heightOfAFullHeightChild(page)).toBeCloseTo(
			after.content!.height,
			1,
		);

		await page.context().setOffline(false);
	});

	test('the chrome keeps its height when the viewport is too short for it', async ({
		page,
	}) => {
		await page.setViewportSize({width: 800, height: 220});
		await page.goto('/');
		const navHeight = (await geometry(page)).nav!.height;

		await page.context().setOffline(true);
		await expect(page.getByTestId('offline-banner')).toBeVisible();

		// Space is scarce enough that something has to give. It is the page, not
		// the chrome: a squashed navbar is a broken navbar, while a short content
		// region is just a page that scrolls.
		const after = await geometry(page);
		expect(Math.round(after.nav!.height)).toBe(Math.round(navHeight));
		expect(after.content!.height).toBeGreaterThanOrEqual(0);

		await page.context().setOffline(false);
	});

	test('ordinary pages still scroll the document', async ({page}) => {
		// The three pages a descendant inherits that are meant to be longer than
		// the screen. The shell clamps the REGION, not the page: content taller
		// than the region overflows it and the window scrolls, which is what keeps
		// native scroll restoration, the mobile URL bar and pull-to-refresh
		// working. If the region ever became the scroller, these would report no
		// document scroll at all.
		for (const path of ['/demo/', '/transactions/', '/explorer/']) {
			await page.goto(path);
			await page.setViewportSize({width: 800, height: 400});

			const {content, documentScrolls, viewportHeight} = await geometry(page);
			expect(documentScrolls, `${path} scrolls the document`).toBe(true);

			// The region itself stayed put while the page overflowed it: it is a
			// height contract, not a scroll container.
			expect(Math.round(content!.bottom)).toBe(viewportHeight);

			await page.evaluate(() => window.scrollBy(0, 300));
			expect(
				await page.evaluate(() => window.scrollY),
				`${path} actually scrolled`,
			).toBeGreaterThan(0);
		}
	});
});
