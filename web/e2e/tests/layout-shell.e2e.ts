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

	test('two live bars never cover each other', async ({page}) => {
		// THE BUG, which is invisible with one bar and total with two. Every bar
		// used to carry `sticky top-[var(--navbar-height)]`, meaning "pin me one
		// navbar from the top", which is only true for the FIRST bar. Two live
		// conditions pinned to the same offset, so a scroll of one bar's height put
		// the second exactly on top of the first, and the first was never seen
		// again. `AppShell` pins the group instead.
		await page.setViewportSize({width: 1280, height: 348});
		await page.goto('/');

		await page.context().setOffline(true);
		const first = page.getByTestId('offline-banner');
		await expect(first).toBeVisible();

		// A SECOND BAR, as a sibling in the same group. Injected rather than
		// provoked: two real conditions at once needs a stale nonce cache alongside
		// a dead network, which is a long setup for a fact about layout, and the
		// claim here is about the POSITION a second bar occupies, not about which
		// condition put it there. Same reasoning as the `h-full` probe above.
		await page.evaluate(() => {
			const offline = document.querySelector('[data-testid="offline-banner"]')!;
			const probe = document.createElement('div');
			probe.dataset.testid = 'probe-bar';
			probe.style.height = '37px';
			probe.style.background = 'rebeccapurple';
			offline.after(probe);
		});
		const second = page.getByTestId('probe-bar');

		// The bars do not pin themselves. If this ever reads `sticky` again, the
		// offsets are back and so is the overlap.
		expect(
			await first.evaluate((el) => getComputedStyle(el).position),
			'a bar leaves pinning to the shell',
		).toBe('static');
		expect(
			await first.evaluate(
				(el) => getComputedStyle(el.parentElement!).position,
			),
			'and the group around them is what is pinned',
		).toBe('sticky');

		const tops = async () => {
			const a = (await first.boundingBox())!;
			const b = (await second.boundingBox())!;
			return {
				aTop: Math.round(a.y),
				aBottom: Math.round(a.y + a.height),
				bTop: Math.round(b.y),
			};
		};

		const atRest = await tops();
		expect(atRest.bTop, 'the second bar sits under the first').toBe(
			atRest.aBottom,
		);

		// Past the point where the old per-bar offsets collapsed onto each other.
		await page.evaluate(() => window.scrollTo(0, 120));
		await expect
			.poll(async () => (await tops()).bTop, {
				message: 'the second bar is still below the first, not on top of it',
			})
			.toBe((await tops()).aBottom);

		const scrolled = await tops();
		expect(
			scrolled.aTop,
			'the two never share a top, which is what the overlap looked like',
		).not.toBe(scrolled.bTop);

		await page.context().setOffline(false);
	});

	test('the bar group stays pinned for exactly one region-height of scroll', async ({
		page,
	}) => {
		// THE CONCESSION, pinned to a number so it cannot drift into something
		// worse unnoticed. The group's containing block is the shell's content box,
		// which runs from the navbar's bottom to the fold, so the group can be
		// pushed down by `viewport - navbar - group`, which IS the region's height.
		//
		// 348 tall because this is only reachable on a page whose content is more
		// than twice the region, and at an ordinary window nothing in this app is
		// (the tallest is 690 against a 1030 threshold at 600). A short window is
		// also the only place a user would meet it.
		await page.setViewportSize({width: 1280, height: 348});
		await page.goto('/');
		await page.context().setOffline(true);
		await expect(page.getByTestId('offline-banner')).toBeVisible();

		const groupTop = () =>
			page.evaluate(() =>
				Math.round(
					document
						.querySelector('[data-app-content]')!
						.previousElementSibling!.getBoundingClientRect().top,
				),
			);

		const {content, nav} = await geometry(page);
		const travel = Math.round(content!.height);
		const pinnedAt = Math.round(nav!.height);

		// THE PRECONDITION. If the page cannot out-scroll the travel there is
		// nothing to observe, and both assertions below pass while proving nothing.
		const maxScroll = await page.evaluate(() => {
			const doc = document.documentElement;
			return doc.scrollHeight - doc.clientHeight;
		});
		expect(
			maxScroll,
			'the page has to out-scroll the group, or this test proves nothing',
		).toBeGreaterThan(travel);

		await page.evaluate((y) => window.scrollTo(0, y), travel);
		await expect
			.poll(groupTop, {
				message: 'still pinned after exactly one region of scrolling',
			})
			.toBe(pinnedAt);

		await page.evaluate((y) => window.scrollTo(0, y), travel + 20);
		await expect
			.poll(groupTop, {
				message: 'and past it, it slides under the navbar rather than over it',
			})
			.toBe(pinnedAt - 20);

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
