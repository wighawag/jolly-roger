import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CHROME} from '$lib/ui/chrome';

const web = (path: string) =>
	fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(web(path), 'utf-8');
/** Source with comments removed: the comments quote the pattern being banned. */
const code = (path: string) => read(path).replace(/<!--[\s\S]*?-->/g, '');

/** Every bar in the list, as a source path. */
const BAR_SOURCES = [
	'src/lib/ui/in-flight/SendingIndicator.svelte',
	'src/lib/ui/offline/OfflineBanner.svelte',
	'src/lib/ui/nonce-cache/NonceCacheBanner.svelte',
	'src/lib/ui/rpc-health/RpcHealthBanner.svelte',
];

/**
 * Guards, not unit tests, in the spirit of `core/ui/layers.test.ts`.
 *
 * The chrome list exists so that WHICH bars an app has stops being markup in
 * `routes/+layout.svelte`. That only pays off while the list stays the single
 * answer: a bar that is in the list twice, or gated by a predicate nobody
 * checks, fails the same silent way the stacking bug did.
 */
describe('the chrome list', () => {
	it('names each bar once, so the {#each} key is an identity', () => {
		const names = CHROME.map((bar) => bar.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('says what every bar reports, for whoever adds the next one', () => {
		for (const bar of CHROME) {
			expect(
				bar.reports.length,
				`${bar.name} says what it reports`,
			).toBeGreaterThan(20);
		}
	});

	/**
	 * The one gate that is a ROUTE question rather than a domain one. It moved
	 * out of the layout when the list went in, and this is what says it moved
	 * intact: the home page reads no onchain data, so an unhealthy RPC is not yet
	 * the user's problem there.
	 */
	it('keeps the RPC bar off the home route and nowhere else', () => {
		const rpc = CHROME.find((bar) => bar.name === 'rpc-health');
		expect(rpc, 'the RPC bar is in the list').toBeDefined();
		expect(rpc!.when, 'and it is route-gated').toBeTypeOf('function');

		expect(rpc!.when!({routeId: '/'})).toBe(false);
		for (const routeId of ['/transactions', '/explorer', '/demo', null]) {
			expect(rpc!.when!({routeId}), `visible on ${routeId}`).toBe(true);
		}
	});

	it('gates nothing else on the route, so a bar cannot go missing quietly', () => {
		const gated = CHROME.filter((bar) => bar.when).map((bar) => bar.name);
		expect(gated).toEqual(['rpc-health']);
	});

	/**
	 * THE BUG THIS GUARDS, because it is invisible until two conditions are live
	 * at once. Every bar used to carry `sticky top-[var(--navbar-height)]`, which
	 * means "pin me one navbar from the top" and is only true for the FIRST bar.
	 * With two up, both pinned to the same offset and 37px of scroll put the
	 * second exactly on top of the first.
	 *
	 * `AppShell` pins the group instead, so a bar that pins itself is a bar that
	 * has re-armed it. The e2e measures the geometry; this says the shape that
	 * produced it cannot come back by copy-paste, which is how it would.
	 */
	it('leaves pinning to the shell, so two live bars cannot share an offset', () => {
		for (const source of BAR_SOURCES) {
			const markup = code(source);
			expect(markup, `${source} does not pin itself`).not.toMatch(/\bsticky\b/);
			expect(
				markup,
				`${source} does not carry a top offset of its own`,
			).not.toMatch(/\btop-\[var\(--navbar-height\)\]/);
		}
	});

	it('pins the group exactly once, in the shell', () => {
		const shell = code('src/lib/core/ui/AppShell.svelte');
		const pins = shell.match(/sticky top-\[var\(--navbar-height\)\]/g) ?? [];
		expect(pins).toHaveLength(1);
	});
});
