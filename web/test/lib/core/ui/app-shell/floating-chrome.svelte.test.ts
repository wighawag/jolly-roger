import {describe, it, expect} from 'vitest';
import {render} from 'vitest-browser-svelte';
import Harness from './AppShellHarness.svelte';

/**
 * A SURFACE CAN LET ITS CHROME FLOAT, and this pins both contracts side by side.
 *
 * The ordinary one (`layout-shell.e2e.ts` holds it on real pages): the shell
 * reserves the navbar's height and the page starts below it. The floating one:
 * nothing is reserved, the page gets the whole viewport, and the navbar is
 * drawn over it. Here rather than only in the e2e because this template has no
 * floating page of its own to walk; a game descendant has one, and its e2e
 * covers the real thing.
 */
describe('the shell’s two contracts', () => {
	const rects = () => {
		const nav = document.querySelector('[data-app-navbar]')!;
		const content = document.querySelector('[data-app-content]')!;
		return {
			nav: nav.getBoundingClientRect(),
			content: content.getBoundingClientRect(),
			floating: !!document.querySelector('[data-app-shell-floating]'),
		};
	};

	it('reserves the navbar’s height by default', async () => {
		render(Harness, {});
		const {nav, content, floating} = rects();

		expect(floating).toBe(false);
		expect(nav.height).toBeGreaterThan(0);
		expect(Math.round(content.top)).toBe(Math.round(nav.bottom));
	});

	it('gives a floating surface the whole viewport, under a navbar still there', async () => {
		render(Harness, {floating: true});
		const {nav, content, floating} = rects();

		expect(floating).toBe(true);
		expect(nav.height).toBeGreaterThan(0);
		expect(Math.round(content.top)).toBe(0);
		expect(Math.round(content.bottom)).toBe(window.innerHeight);
	});
});
