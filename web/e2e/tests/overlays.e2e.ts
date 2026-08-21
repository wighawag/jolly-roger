import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';

/**
 * The behaviour ADR-0004 (`work` branch) exists to guarantee, driven
 * through a real browser because the things most likely to break it are a real
 * browser's: the history stack, the back gesture, and paint order.
 *
 * The navbar drawer is the subject rather than the transaction inspector
 * because it needs no wallet, no node state and no in-flight transaction, so a
 * failure here means the mechanism broke rather than that a fixture drifted.
 * The inspector has its own suite in pending-operation.e2e.ts.
 */
describe('View overlays and navigation', () => {
	// Scoped to the layer containers `+layout.svelte` declares, which is also an
	// assertion: each overlay has to land in its own layer. They share z-50, so
	// paint order is DOM order, and the containers are what make that order
	// deliberate rather than a consequence of where a component happens to live.
	const drawerOf = (page: Page) =>
		page.locator('#--layer-drawer [role="dialog"]');
	const modalOf = (page: Page) =>
		page.locator('#--layer-modals [role="dialog"]');

	/**
	 * The navbar is prerendered, so the button exists before the app can answer
	 * it: a click during hydration is swallowed and the drawer never opens. Retry
	 * until it takes, as home.e2e.ts does for the same reason.
	 */
	async function openDrawer(page: Page) {
		await expect(async () => {
			await page.getByLabel('Open menu').click();
			await expect(drawerOf(page)).toBeVisible({timeout: 2000});
		}).toPass({timeout: 30000});
	}

	test('closes when a link inside it navigates the page', async ({page}) => {
		await page.goto('/');
		await openDrawer(page);

		await drawerOf(page).getByRole('link', {name: 'Explorer'}).click();

		await expect(page).toHaveURL(/\/explorer\/?(\?.*)?$/);
		// The overlay belonged to the page it was opened from: it does not come
		// along. This is the bug that started ADR-0004.
		await expect(drawerOf(page)).toHaveCount(0);
	});

	test('the back gesture closes it instead of leaving the page', async ({
		page,
	}) => {
		await page.goto('/demo/');
		await openDrawer(page);
		const urlWithOverlayOpen = page.url();

		// Opening pushed a history entry of our own, so back has something of ours
		// to consume and the user stays where they were. On a phone this is the
		// only dismiss gesture there is: there is no ESC.
		await page.goBack();

		await expect(drawerOf(page)).toHaveCount(0);
		// Same page, and the URL never changed: a prompt overlay is not addressable.
		expect(page.url()).toBe(urlWithOverlayOpen);
	});

	test('the overlay layers are declared, applied, and ordered', async ({
		page,
	}) => {
		await page.goto('/');

		const layers = await page.evaluate(() =>
			[...document.querySelectorAll('[data-layer]')].map((el) => ({
				layer: (el as HTMLElement).dataset.layer,
				z: Number(getComputedStyle(el).zIndex),
				position: getComputedStyle(el).position,
			})),
		);

		// The order every floating surface in the app is ranked by. Assert the
		// intent, not the numbers: what matters is that a modal covers a toast and
		// a toast covers the drawer, whatever values app.css gives them.
		expect(layers.map((l) => l.layer)).toEqual([
			'drawer',
			'notice',
			'toast',
			'modal',
			'progress',
		]);

		for (const layer of layers) {
			// `position: relative` plus a real z-index is what makes a layer a
			// stacking context, which is what confines each surface's own z-index
			// (shadcn's z-50, sonner's 999999999) to its layer. A NaN z means the
			// rule or the custom property went missing, and the whole scheme is off.
			expect(layer.position, `${layer.layer} layer is positioned`).toBe(
				'relative',
			);
			expect(layer.z, `${layer.layer} layer has a z-index`).not.toBeNaN();
		}

		const zs = layers.map((l) => l.z);
		expect(zs, 'layers must be strictly increasing').toEqual(
			[...zs].sort((a, b) => a - b),
		);
		expect(new Set(zs).size, 'no two layers share a z-index').toBe(zs.length);
	});

	test('a modal raised from inside the drawer sits on top of it', async ({
		page,
	}) => {
		await page.goto('/');
		await openDrawer(page);

		await drawerOf(page)
			.getByRole('button', {name: /^connect$/i})
			.click();

		const modal = modalOf(page).first();
		await expect(modal).toBeVisible({timeout: 30000});

		// The real assertion is HITTABILITY, not visibility: the bug this guards
		// against left the wallet picker on screen with the drawer's dimming overlay
		// swallowing every click on it. A trial click runs Playwright's actionability
		// checks, including "receives pointer events", without connecting a wallet.
		await modal
			.getByRole('button')
			.first()
			.click({trial: true, timeout: 10000});
	});
});
