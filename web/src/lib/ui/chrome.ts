import type {Component} from 'svelte';
import {chromeBar, type ChromeBar} from '$lib/core/ui/chrome';
import SendingBar from './in-flight/SendingBar.svelte';
import OfflineBanner from './offline/OfflineBanner.svelte';
import NonceCacheBanner from './nonce-cache/NonceCacheBanner.svelte';
import RpcHealthBanner from './rpc-health/RpcHealthBanner.svelte';

/**
 * THIS APP'S CHROME, top to bottom. The order of this array is the order on
 * screen.
 *
 * HERE RATHER THAN IN `core/`, unlike `layers.ts`, and the split is the point.
 * WHICH bars an app has is an app's own business: a descendant that drops the
 * nonce-cache bar or adds a "round closing in 20s" bar edits THIS file, which
 * the template touches rarely, instead of `routes/+layout.svelte`, which it
 * touches constantly. `core/ui/chrome.ts` holds only the shape, and
 * `core/ui/AppShell.svelte` holds the height contract, which is not an app's
 * business (see the note there on why the contract is deliberately not
 * replaceable).
 *
 * Adding one is one line. It renders in the flow, so the content region shrinks
 * by exactly its height and nothing goes under the fold.
 */
export const CHROME = [
	chromeBar(
		'sending',
		SendingBar,
		'A dispatch being awaited, when the app chose the in-flow placement. ' +
			'First because it is the most transient of the four, so it reads as ' +
			'the newest thing to have happened.',
	),
	chromeBar(
		'offline',
		OfflineBanner,
		'The browser reports no network. Above the RPC bars because it explains ' +
			'them: an offline device has no working RPC either, and two bars ' +
			'saying so is one bar too many (RpcHealthBanner suppresses itself ' +
			'while this one is up).',
	),
	chromeBar(
		'nonce-cache',
		NonceCacheBanner,
		'The cached nonce disagrees with the chain, so the next send would be ' +
			'rejected. A user action is needed, unlike the two around it.',
	),
	chromeBar(
		'rpc-health',
		RpcHealthBanner,
		'No RPC configured and no wallet connected, or the RPC is failing. ' +
			'Last because it is the condition a user can do least about.',
		{
			// The home page reads no onchain data, so an unhealthy RPC is not yet a
			// problem there. A route id rather than a pathname: it is base-path
			// independent, so this still works under IPFS and relative deploys.
			when: ({routeId}) => routeId !== '/',
		},
	),
] as const satisfies readonly ChromeBar[];

/**
 * WHAT ONE SURFACE GETS ABOVE ITS PAGE: a navbar and a list of bars.
 *
 * A **surface** is whatever owns the screen right now. Almost always that is
 * this app showing a page, and then the answer is `APP_CHROME` below and there
 * is nothing to declare. The case this type exists for is the other one: a page
 * that is not showing THIS app at all.
 *
 * THE TEST THAT DECIDES, AND IT IS NOT "EMBEDDED VERSUS FULL SCREEN". It is
 * whether the chrome's CLAIMS REMAIN TRUE of the surface the player is looking
 * at. The chrome says who you are connected as, what you hold and whether the
 * chain is answering. A page that embeds something else as ONE THING among
 * others - a demo panel, a preview, a world in a frame - leaves every one of
 * those claims true of the app around it, so it keeps the app's chrome and
 * declares nothing. A page a different world OWNS makes them false: the account
 * on screen is one that world generated, the connection is to something that is
 * not a network, and the player who met the online version first reads the
 * position on screen as "my account changed".
 *
 * A surface in the second case declares its own, and what it then shows follows
 * from the same test rather than from taste: a control whose only truthful value
 * here is "not applicable" is ABSENT, not disabled and not showing a
 * placeholder. See ADR-0009 (`work` branch), and ADR-0004 on
 * `template-commit-reveal`'s `work` branch for the case that produced it.
 *
 * WHERE A DECLARATION LIVES: on the route's own PAGE DATA, as `surfaceChrome`
 * (see `app.d.ts`), which is to say in a `+page.ts` beside the `+page.svelte`
 * that needs it. Three things follow, and all three are why it is not a
 * route-id table in this file or an `{#if}` in `+layout.svelte`.
 *
 * 1. The answer is in the directory of the surface it is about, so whoever edits
 *    the page has the declaration open.
 * 2. A repo that DELETES an inherited route deletes its declaration with it.
 *    A table keyed on route ids would keep an entry pointing at a page that no
 *    longer exists, and a per-route `if` would keep it in the most-edited file
 *    in this template.
 * 3. It is static and it prerenders, so the chrome does not depend on anything
 *    having mounted. A surface's navbar is up in the first paint, exactly as
 *    the app's is.
 *
 * TWO OBLIGATIONS ON A DECLARED NAVBAR, both load-bearing.
 *
 * **Its root must carry `data-app-navbar`.** A replacement navbar is still a
 * navbar: the shell reserves `var(--navbar-height)` for it whatever it is, and
 * `e2e/tests/layout-shell.e2e.ts` measures that attribute to hold the geometry
 * contract (the page sits BELOW the chrome, not under it). This template shipped
 * the other outcome once, and the casualty was a game's phase countdown. See the
 * `navbar` prop in `core/ui/AppShell.svelte`.
 *
 * **It is rendered by the LAYOUT, outside every route subtree.** That is not an
 * implementation detail, it is the constraint that shapes these components: a
 * page that provides its own context (svelte's `setContext` shadows for a
 * SUBTREE) is BELOW this, so a declared navbar cannot see it and must not try.
 * Take the facts from app-scoped modules instead - the same modules the page
 * itself starts the world with - which is what makes it possible to say what a
 * world is without being inside it. Like a bar, a declared navbar is therefore
 * zero-prop and self-gating: it renders what is true now and nothing when there
 * is nothing yet to say.
 */
export type SurfaceChrome = {
	/**
	 * The bar at the top, or `undefined` for the app's own. Absent is the answer
	 * for a surface that only wants a bar of its own.
	 */
	readonly navbar?: Component;
	/** The condition bars, top to bottom. `[]` for none. */
	readonly bars: readonly ChromeBar[];
};

/**
 * WHAT A SURFACE GETS WHEN IT DECLARES NOTHING, which is every route in this app
 * and every route in every descendant until one says otherwise.
 *
 * No navbar of its own, meaning the app's, and this app's bars.
 */
export const APP_CHROME: SurfaceChrome = {bars: CHROME};

/**
 * THE SELECTION, and the whole of it. `routes/+layout.svelte` renders what this
 * returns and decides nothing itself, so "which chrome is this" is one function
 * with a test on both of its directions rather than a condition in markup.
 *
 * Takes page data rather than reading it, because only `routes/**` and
 * `lib/kit` may ask the framework where it is (`lib/kit/README.md`).
 */
export function chromeFor(data: {
	readonly surfaceChrome?: SurfaceChrome;
}): SurfaceChrome {
	return data.surfaceChrome ?? APP_CHROME;
}
