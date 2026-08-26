import {describe, it, expect} from 'vitest';
import {CHROME} from '$lib/ui/chrome';

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
});
