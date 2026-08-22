import {describe, it, expect, vi} from 'vitest';
import {render} from 'vitest-browser-svelte';
import Harness from './ModalStackingHarness.svelte';
import Reversed from './ReversedHarness.svelte';

/**
 * What decides which modal is on top WITHIN the modal layer.
 *
 * The layer scale in app.css ranks layers against each other. Inside one layer
 * every dialog carries the same z-index, so paint order is DOM order, and DOM
 * order is decided ONCE, when the component owning the dialog mounts: bits-ui's
 * portal mounts a consumer into the layer and keeps it there, rendering the
 * dialog's content into that fixed slot as it opens and closes.
 *
 * So the rule is DECLARATION ORDER, not open order. That is unobvious enough,
 * and load-bearing enough (it is why `context/AcrossPages.svelte` cares about
 * the order its components are written in), to be pinned by tests against the
 * real components rather than described in a comment.
 */
const titles = () =>
	[
		...document.querySelectorAll(
			'#--layer-modals [data-slot="dialog-content"]',
		),
	].map(
		(el) =>
			el.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() ?? '',
	);

describe('modal stacking within the modal layer', () => {
	it('reserves a slot per dialog when its component mounts, before it opens', async () => {
		await render(Harness, {parentOpen: false, childOpen: false});
		const layer = document.querySelector('#--layer-modals');

		// No dialog is open, yet the layer already holds both portals' markers.
		// This is why opening later cannot move a dialog to the top.
		expect(layer).toBeTruthy();
		expect(layer!.childNodes.length).toBeGreaterThan(0);
		expect(titles()).toEqual([]);
	});

	it('paints a dialog raised from another above it, when it is declared after', async () => {
		const screen = await render(Harness, {parentOpen: true});
		await vi.waitFor(() => expect(titles()).toEqual(['Parent modal']));

		await screen.rerender({parentOpen: true, childOpen: true});
		await vi.waitFor(() =>
			expect(titles()).toEqual(['Parent modal', 'Child prompt']),
		);
	});

	it('keeps its slot across close and reopen', async () => {
		const screen = await render(Harness, {parentOpen: true, childOpen: true});
		await vi.waitFor(() =>
			expect(titles()).toEqual(['Parent modal', 'Child prompt']),
		);

		await screen.rerender({parentOpen: false, childOpen: true});
		await vi.waitFor(() => expect(titles()).toEqual(['Child prompt']));

		// Back into its ORIGINAL slot, underneath the prompt, rather than on top
		// of it: a modal that closes and reopens cannot jump the stack.
		await screen.rerender({parentOpen: true, childOpen: true});
		await vi.waitFor(() =>
			expect(titles()).toEqual(['Parent modal', 'Child prompt']),
		);
	});

	it('follows declaration order even when the later-declared dialog opens FIRST', async () => {
		// The same two dialogs, declared in the opposite order. The parent opens
		// first and the prompt second, exactly as in the nesting case, and the
		// prompt still lands UNDERNEATH: opening later buys nothing.
		//
		// This is the failure mode a template user will hit, and the reason
		// AcrossPages.svelte's component order is load-bearing.
		const screen = await render(Reversed, {parentOpen: true});
		await vi.waitFor(() => expect(titles()).toEqual(['Parent modal']));

		await screen.rerender({parentOpen: true, childOpen: true});
		await vi.waitFor(() =>
			expect(titles()).toEqual(['Child prompt', 'Parent modal']),
		);
	});
});
