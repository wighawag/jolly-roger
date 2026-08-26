import type {Component} from 'svelte';

/**
 * What the app shell puts above the page: the ordered list of condition bars.
 *
 * WHY A LIST RATHER THAN MARKUP
 *
 * The same reason `layers.ts` is a list. `routes/+layout.svelte` is the
 * most-edited file in this template, so anything spelled out there is spelled
 * out in the one file every descendant has already changed, and a template
 * update that touches it conflicts with all of them at once. Measured, at the
 * commit that introduced the height shell: merging it into
 * `template-commit-reveal` conflicted on 127 of 257 lines, because the shell
 * both wrapped the chrome block and re-indented it, and git cannot match a
 * re-indented block against an edited one.
 *
 * A list moves the part descendants actually change (WHICH bars exist, in what
 * order) into a file the template rarely touches, and leaves the part they must
 * not change (the height contract, in `AppShell.svelte`) in a file they never
 * touch. Two files that merge cleanly instead of one that always conflicts.
 *
 * WHAT THIS DELIBERATELY DOES NOT MAKE REPLACEABLE
 *
 * The height contract itself. The bug the shell exists to prevent was armed in
 * the TEMPLATE, so it was armed once for every descendant, and a shell an app
 * can simply swap out is a shell an app can re-arm it behind. `template-commit-
 * reveal` proved that from the other direction: it wrote
 * `h-[calc(100dvh-3rem)]` for its game route, which subtracts the navbar and
 * forgets the bars, so any bar being up pushed the bottom of its HUD under the
 * fold. The list is the seam; the contract is not.
 *
 * WHY THE BARS THEMSELVES ARE ZERO-PROP
 *
 * Each one decides its own visibility from the app context, so this list says
 * only that a bar EXISTS and where it sits. A bar wired here would need its
 * dependencies threaded through the shell, and the shell would then know what
 * an RPC is.
 */
export type ChromeBar = {
	/** Stable identity, used as the `{#each}` key and in tests. */
	readonly name: string;
	/**
	 * The bar. Zero-prop and self-gating: it renders nothing when its condition
	 * is not met.
	 */
	readonly component: Component;
	/** What condition this reports, for whoever adds the next one. */
	readonly reports: string;
	/**
	 * Optional gate for a bar whose relevance is a ROUTE question rather than a
	 * domain one, which a self-gating component cannot answer without importing
	 * the framework (see `lib/kit/README.md` for why it must not).
	 *
	 * Keyed on `routeId` rather than a pathname because a route id is base-path
	 * independent, which matters under IPFS and relative deploys.
	 */
	readonly when?: (where: {readonly routeId: string | null}) => boolean;
};

/** One bar. A function so the shape cannot drift between entries. */
export function chromeBar(
	name: string,
	component: Component,
	reports: string,
	options: {when?: ChromeBar['when']} = {},
): ChromeBar {
	return {name, component, reports, when: options.when};
}
