import {describe, it, expect, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';
import Harness from './LayerStackingHarness.svelte';

/**
 * WHAT DECLARATION ORDER CANNOT DO: reach across two layers.
 *
 * `modal-stacking.svelte.test.ts` pins that declaration order decides stacking,
 * and it is right - WITHIN one layer, which is the only case it renders. That
 * gap is not academic. It let a real inversion through review and stay there:
 *
 *   `InsufficientFundsModal` is `layer="system"`. It offers "Top up the in-app
 *   balance", and `TopUpModal` named no layer at all, so it took the default,
 *   `'modal'`, one rank BELOW. `AcrossPages.svelte` declared it after the funds
 *   modal and said in a comment that the ordering was what put it on top. A
 *   layer is a stacking context, so it did not. Clicking the button opened a
 *   dialog BEHIND the dialog the button was in, showing "Let this browser play
 *   for you" through the modal covering it.
 *
 * Every assertion in the sibling suite passed throughout, because both of its
 * dialogs are in one layer. So this file renders the two-layer case: the same
 * declaration order, and the layer varied underneath it.
 *
 * It is also the test for the fix. `layer` is now required (see the prop's note
 * in modal.svelte), so this arrangement can no longer be reached by omission -
 * but it can still be reached by writing the wrong value, and what it looks like
 * when you do is worth having on record.
 */
const titlesInPaintOrder = () =>
	[
		...document.querySelectorAll(
			'#--layer-modals [data-slot="dialog-content"], #--layer-system [data-slot="dialog-content"]',
		),
	].map(
		(el) =>
			el.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() ?? '',
	);

const layerOf = (title: string) => {
	const content = [
		...document.querySelectorAll('[data-slot="dialog-content"]'),
	].find(
		(el) =>
			el.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() ===
			title,
	);
	return content?.closest('[data-layer]')?.getAttribute('data-layer');
};

const zOf = (selector: string) =>
	Number(getComputedStyle(document.querySelector(selector)!).zIndex);

describe('a modal raised from a system modal', () => {
	it('lands UNDER it when it takes the modal layer, however it is declared', async () => {
		// The bug, reproduced. The raised modal is declared second and opens
		// second, and both of those are what the app was relying on.
		const screen = await render(Harness, {
			systemOpen: true,
			raisedLayer: 'modal',
		});
		await screen.rerender({
			systemOpen: true,
			raisedOpen: true,
			raisedLayer: 'modal',
		});

		await vi.waitFor(() => {
			expect(layerOf('Insufficient Funds')).toBe('system');
			expect(layerOf('Top up the in-app balance')).toBe('modal');
		});

		// The layer, not the order, is what paints last: the funds modal is on top
		// of the dialog it opened.
		expect(zOf('#--layer-system')).toBeGreaterThan(zOf('#--layer-modals'));
		expect(titlesInPaintOrder()).toEqual([
			'Top up the in-app balance',
			'Insufficient Funds',
		]);
	});

	it('lands OVER it once it shares the layer, by the declaration order that was always there', async () => {
		// The one-word fix. Nothing about the declaration order changed; it only
		// started to apply, because both dialogs are now in one stacking context.
		const screen = await render(Harness, {
			systemOpen: true,
			raisedLayer: 'system',
		});
		await screen.rerender({
			systemOpen: true,
			raisedOpen: true,
			raisedLayer: 'system',
		});

		await vi.waitFor(() => {
			expect(layerOf('Insufficient Funds')).toBe('system');
			expect(layerOf('Top up the in-app balance')).toBe('system');
		});

		expect(titlesInPaintOrder()).toEqual([
			'Insufficient Funds',
			'Top up the in-app balance',
		]);
	});
});
