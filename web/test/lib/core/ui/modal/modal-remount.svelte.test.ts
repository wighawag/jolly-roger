import {describe, it, expect, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';
import Harness from './RouteRemountHarness.svelte';

/**
 * A SYSTEM overlay must stay above a page's own modal, however the user got to
 * the page.
 *
 * THE BUG THIS PINS. Within one layer, stacking is decided when a component
 * mounts (see modal-stacking.svelte.test.ts). That is stable for components
 * that mount together and stay mounted, and `context/AcrossPages.svelte` relies
 * on it. It is NOT stable across the layout/page boundary: the router unmounts
 * and remounts a page's modals on every navigation, so they take a fresh slot at
 * the END of the layer, while AcrossPages keeps the slot it took when the app
 * started.
 *
 * So the same two modals stacked one way on a cold load and the other way after
 * a single navigation. In the field that showed up as "Wallet Action Required"
 * sitting BEHIND the mint dialog that was waiting on it: the user saw a spinner
 * and no way to learn their wallet was asking them something.
 *
 * The fix is not a better declaration order, because no declaration order can
 * express this. It is that the two kinds of overlay ADR-0004 already
 * distinguishes live in two LAYERS, and a layer is a stacking context, so the
 * guarantee holds no matter when anything mounted.
 */
const titlesIn = (layer: string) =>
	[
		...document.querySelectorAll(
			`#${CSS.escape(layer)} [data-slot="dialog-content"]`,
		),
	].map(
		(el) =>
			el.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() ?? '',
	);

const zOf = (selector: string) =>
	Number(getComputedStyle(document.querySelector(selector)!).zIndex);

describe('system overlays outrank page modals across a route remount', () => {
	it('ranks the system layer above the modal layer', async () => {
		await render(Harness, {});
		// Guards the guard: if either layer lost its z-index (a typo in a custom
		// property falls back to `auto`), every assertion below would be vacuous.
		expect(Number.isFinite(zOf('#--layer-modals'))).toBe(true);
		expect(Number.isFinite(zOf('#--layer-system'))).toBe(true);
		expect(zOf('#--layer-system')).toBeGreaterThan(zOf('#--layer-modals'));
	});

	it('puts each modal in its own layer on a cold load', async () => {
		const screen = await render(Harness, {pageMounted: true});
		await screen.rerender({
			pageMounted: true,
			pageOpen: true,
			systemOpen: true,
		});
		await vi.waitFor(() => {
			expect(titlesIn('--layer-modals')).toEqual(['Page modal']);
			expect(titlesIn('--layer-system')).toEqual(['Wallet Action Required']);
		});
	});

	it('keeps them there after the page has remounted', async () => {
		const screen = await render(Harness, {pageMounted: true});

		// Navigate away: the page unmounts and gives up its slot.
		await screen.rerender({pageMounted: false});
		// Navigate back: the page remounts and takes a slot AFTER the one
		// AcrossPages has held since the app started. Before the layer split this
		// is the point at which the page modal started covering the system one.
		await screen.rerender({pageMounted: true});
		await screen.rerender({
			pageMounted: true,
			pageOpen: true,
			systemOpen: true,
		});

		await vi.waitFor(() => {
			expect(titlesIn('--layer-modals')).toEqual(['Page modal']);
			expect(titlesIn('--layer-system')).toEqual(['Wallet Action Required']);
		});
	});
});
