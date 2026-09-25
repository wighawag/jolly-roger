import {describe, it, expect} from 'vitest';
import {render} from 'vitest-browser-svelte';
import Harness from './SurfaceNavbarHarness.svelte';
import ASurfacesOwnNavbar from './ASurfacesOwnNavbar.svelte';

/**
 * THE CHROME IS A PER-SURFACE CHOICE, AND THIS IS THE RENDERING HALF OF IT.
 * `surface-chrome.test.ts` holds the deciding half and the reasoning; this file
 * holds what actually reaches the screen, in a real browser, which is the only
 * place "instead of" can be distinguished from "as well as".
 *
 * NEITHER NAVBAR HERE IS REAL, on purpose. What is under test is WHICH one is
 * rendered, and this app's own navbar reads the connection, the account, the
 * balance and the credits view out of the app context, so using it would mean
 * standing up an app to answer a question that has nothing to do with one. Both
 * stand-ins carry `data-app-navbar`, because every navbar must.
 */
describe('the navbar a surface gets', () => {
	it('is the app’s when the surface declared none', async () => {
		const screen = await render(Harness, {navbar: undefined});

		await expect
			.element(screen.getByTestId('the-apps-own-navbar'))
			.toBeInTheDocument();
		await expect
			.element(screen.getByTestId('a-surfaces-own-navbar'))
			.not.toBeInTheDocument();
	});

	it('is its own INSTEAD OF the app’s when it declared one', async () => {
		const screen = await render(Harness, {navbar: ASurfacesOwnNavbar});

		await expect
			.element(screen.getByTestId('a-surfaces-own-navbar'))
			.toBeInTheDocument();
		// INSTEAD OF, not as well as. Two navbars would put the app's account back
		// on screen beside the world's, which is worse than either alone.
		await expect
			.element(screen.getByTestId('the-apps-own-navbar'))
			.not.toBeInTheDocument();
	});

	it('leaves exactly one `data-app-navbar` either way, because the shell measures it', async () => {
		// THE GEOMETRY CONTRACT SURVIVES THE SWAP. The shell reserves
		// `var(--navbar-height)` for whatever sits in this slot, and
		// `e2e/tests/layout-shell.e2e.ts` measures `[data-app-navbar]` to hold that
		// the page sits BELOW the chrome rather than under it. Two of them, or none,
		// and that measurement stops meaning anything - which is how a game's phase
		// countdown ended up under a navbar in this tree once already.
		const screen = await render(Harness, {navbar: undefined});
		expect(document.querySelectorAll('[data-app-navbar]')).toHaveLength(1);

		await screen.rerender({navbar: ASurfacesOwnNavbar});
		expect(document.querySelectorAll('[data-app-navbar]')).toHaveLength(1);
	});
});
