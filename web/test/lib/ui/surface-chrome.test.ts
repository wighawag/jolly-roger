import {describe, it, expect} from 'vitest';
import {chromeBar} from '$lib/core/ui/chrome';
import {APP_CHROME, CHROME, chromeFor} from '$lib/ui/chrome';
import ASurfacesOwnNavbar from './ASurfacesOwnNavbar.svelte';

/**
 * THE CHROME IS A PER-SURFACE CHOICE, AND THIS IS THE DECIDING HALF OF IT.
 *
 * The mechanism is two halves, and each is useless alone: `chromeFor` decides
 * WHICH chrome a surface gets, and `SurfaceNavbar` renders WHICHEVER it decided.
 * The second half is pinned by `surface-navbar.svelte.test.ts`, which is a
 * separate file only because it needs a real browser and this one must not: this
 * file imports the app's chrome list, whose bars reach the app barrel and its
 * configuration, and the split by project is how this repo keeps those two kinds
 * of test off each other's machine (see `vite.config.ts`).
 *
 * BOTH DIRECTIONS ARE ASSERTED, and the one that keeps the app's chrome is the
 * dangerous one. If a declaration were ignored, a world that owns the page would
 * go on showing an account the player never chose, an idle "connected" and a
 * credits figure about nothing - silently, with every other suite green. That is
 * the failure ADR-0009 was written about.
 *
 * AND THE DEFAULT DIRECTION MATTERS AS MUCH. This lands in a template with
 * descendants that adopt nothing, so "a surface that declares nothing gets
 * exactly what it has today" is the clause protecting every repo that is not
 * adopting anything. A selection that resolved to an empty chrome for an ordinary
 * page would take the navbar off every route in this tree at once.
 *
 * THIS IS THE HOME LEVEL. The mechanism lives in jolly-roger because
 * `routes/+layout.svelte` and `core/ui/AppShell.svelte` are byte-identical from
 * here down and only the layout can choose what the shell is given. A descendant
 * that USES it tests what its own chrome SAYS; what it cannot test is the
 * choosing, because by then the choosing is inherited.
 */
describe('which chrome a surface gets', () => {
	// A bar that is nobody's, so an assertion about it cannot accidentally be
	// satisfied by one of the app's four. Its component is beside the point - a
	// bar is identified here by name, never rendered.
	const aBarOfItsOwn = chromeBar(
		'a-surfaces-own-bar',
		ASurfacesOwnNavbar,
		'nothing; it exists to be identified in a list',
	);

	it('gives a surface that declares nothing the app’s chrome', () => {
		const resolved = chromeFor({});

		expect(resolved).toBe(APP_CHROME);
		// No navbar of its own MEANS the app's. Asserted as the absence it is,
		// because that absence is what `SurfaceNavbar` branches on.
		expect(resolved.navbar).toBeUndefined();
		expect(resolved.bars).toBe(CHROME);
	});

	it('gives a surface that declares its own exactly what it declared', () => {
		const declared = {navbar: ASurfacesOwnNavbar, bars: [aBarOfItsOwn]};

		const resolved = chromeFor({surfaceChrome: declared});

		expect(resolved).toBe(declared);
		expect(resolved.navbar).toBe(ASurfacesOwnNavbar);
		expect(resolved.bars).toEqual([aBarOfItsOwn]);
		// Its own INSTEAD OF the app's, not on top of them. The app's bars report
		// the app's connection, the app's dispatches and the app's RPC, so a world
		// that owns the page inheriting even one of them is the same defect in
		// miniature.
		expect(resolved.bars).not.toContain(CHROME[0]);
	});

	it('lets a surface keep the app’s navbar and still declare its own bars', () => {
		// The third case, and it is free: a page that needs to say one more thing
		// while still showing THIS app has nothing to replace up top.
		const resolved = chromeFor({surfaceChrome: {bars: [aBarOfItsOwn]}});

		expect(resolved.navbar).toBeUndefined();
		expect(resolved.bars).toEqual([aBarOfItsOwn]);
	});
});
