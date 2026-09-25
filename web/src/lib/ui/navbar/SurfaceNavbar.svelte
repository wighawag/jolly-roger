<script lang="ts">
	/**
	 * THE NAVBAR THIS SURFACE GETS: its own if it declared one, the app's
	 * otherwise.
	 *
	 * A COMPONENT RATHER THAN AN `{#if}` IN THE LAYOUT, for two reasons that are
	 * both about the file it is keeping out of. `routes/+layout.svelte` is the
	 * most-edited file in this template, so a condition written there is a
	 * condition every descendant re-merges; and a condition written there cannot
	 * be tested, because rendering that layout means standing up the whole app.
	 * Here it is three lines with a test on both branches
	 * (`test/lib/ui/surface-chrome.svelte.test.ts`), and breaking the choice
	 * fails exactly that test.
	 *
	 * THE APP'S OWN ARRIVES AS A SNIPPET, not as a component, and that is what
	 * keeps this file free of the app. This app's navbar needs its identity links
	 * and the path it should highlight, and only the layout can supply those; a
	 * snippet lets the layout keep supplying them exactly as before, unchanged and
	 * un-reindented. It also means the test can hand over a navbar of two lines
	 * instead of the real one, which reads the connection, the account, the
	 * balance and the credits view out of the app context.
	 *
	 * WHAT THIS DOES NOT DO is decide anything about the geometry. A declared
	 * navbar sits in the slot the app's navbar sits in, which is `fixed` and
	 * whose space the shell reserves, so it carries its own `fixed` positioning
	 * and `data-app-navbar` just as this app's navbar does. Nothing is wrapped
	 * here: a wrapper around a `fixed` element is zero-height, and measuring it
	 * would answer the wrong question (see the `navbar` prop in
	 * `core/ui/AppShell.svelte`).
	 */
	import type {Component, Snippet} from 'svelte';

	const {
		navbar,
		appNavbar,
	}: {
		/**
		 * The surface's own navbar, from its `surfaceChrome` declaration, or
		 * `undefined` when it declared none. Zero-prop and self-gating: it is
		 * rendered OUTSIDE every route subtree, so it reads app-scoped modules
		 * rather than a context the page provides. See `$lib/ui/chrome`.
		 */
		navbar?: Component;
		/** This app's own navbar, wired by whoever composes the app. */
		appNavbar: Snippet;
	} = $props();
</script>

{#if navbar}
	{@const SurfaceOwnNavbar = navbar}
	<SurfaceOwnNavbar />
{:else}
	{@render appNavbar()}
{/if}
