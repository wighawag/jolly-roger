<script lang="ts">
	import type {Snippet} from 'svelte';
	import type {ChromeBar} from './chrome';

	const {
		navbar,
		chrome,
		routeId,
		children,
	}: {
		/**
		 * The fixed bar at the top. A snippet rather than an entry in `chrome`
		 * because it is the one piece the shell reserves space for by name, and
		 * because only the app knows what to put in it.
		 */
		navbar: Snippet;
		/** The condition bars, top to bottom. See `chrome.ts`. */
		chrome: readonly ChromeBar[];
		/**
		 * The current route id, as a getter so reading it here tracks the caller's
		 * `page` as if the caller had read it. Only `routes/**` and `lib/kit` may
		 * ask the framework for this, which is why it arrives as a parameter.
		 */
		routeId: () => string | null;
		children: Snippet;
	} = $props();
</script>

<!-- THE HEIGHT SHELL, and the one place that decides how tall the app is.

     A viewport-tall column: the in-flow bars as fixed-size children, and the
     page in a `flex-1 min-h-0` region, which makes that region EXACTLY what the
     chrome leaves and never more. A banner appearing therefore SHRINKS the page
     instead of pushing it down: nothing goes under the fold, and nothing
     re-lays-out when the banner leaves.

     WHAT IT BUYS A DESCENDANT: inside the region, `h-full` means "the viewport
     minus whatever chrome is up right now", so an app with a canvas, a map or a
     board can occupy the screen exactly, with no scrollbar, WITHOUT knowing
     which bars exist or how tall they are. Without a shell every such app
     reaches for `h-screen` somewhere below instead, and `h-screen` plus a bar is
     a page taller than the screen by the height of the bar. That trap was armed
     in the template, so it was armed once for every descendant, which is why it
     is disarmed here rather than in the app that happened to trip it.

     THE NAVBAR IS OUT OF FLOW. It is `fixed` (navbar.svelte says why a sticky
     one could not survive this shell), so it is not a row in this column, and
     `pt-[var(--navbar-height)]` is how the column reserves its space instead.
     Same variable the navbar sizes itself with, so this is one number, not two.

     WHY THE BARS STAY IN FLOW instead of floating clear of the problem: they
     report DURABLE conditions (offline, no RPC, a stale nonce cache) that last
     minutes, and a permanent overlay covering the app's own UI is worse than a
     bar that honestly takes its space. `ui/in-flight/sending.ts` draws the same
     line from the other side, transient action feedback floats and durable
     conditions take space, and the shell is what makes taking space affordable.

     `[&>*]:shrink-0` so that chrome is chrome: on a short viewport the bars keep
     their height and the page absorbs the loss, rather than every bar being
     squeezed into illegibility at once. It reaches the content region too,
     harmlessly: that one grows from a basis of 0, so there is never anything to
     shrink.

     THE DOCUMENT IS STILL THE SCROLLER, which is what keeps ordinary pages
     ordinary: a page longer than the region overflows it and the window scrolls,
     with native scroll restoration on back, the mobile URL bar retracting,
     pull-to-refresh, and `scrollbar-gutter` (app.css) all unchanged.

     THE CONCESSION that remains. A sticky element stays pinned only while its
     containing block is on screen, and this shell is exactly one viewport tall,
     so the BAR GROUP runs out of travel once a page can scroll further than
     `100dvh` minus the navbar and the group's own height. One threshold for all
     of them, since they pin as a group. That is why the navbar is `fixed`
     rather than sticky: losing the navigation is losing the way out, while a bar
     that scrolls away after a screenful of a long page is a bar that has already
     been read. If a descendant decides otherwise, the fix is an app-shell scroller
     (`overflow-y-auto` on the content region), and the price was measured rather
     than guessed: back-navigation scroll restoration stops working entirely
     (SvelteKit saves and restores WINDOW scroll), the scroll-to-top on forward
     navigation has to be reimplemented, and `scrollbar-gutter` has to move off
     `html` or the navbar ends up misaligned with the content by a scrollbar's
     width. -->
<div class="flex h-dvh flex-col pt-[var(--navbar-height)] [&>*]:shrink-0">
	{@render navbar()}

	<!-- ONE STICKY ELEMENT FOR ALL THE BARS, not one per bar, and it is a
	     correctness fix rather than tidying.

	     Each bar used to carry `sticky top-[var(--navbar-height)]` itself, which
	     says "pin me one navbar from the top" and is only true for the FIRST bar.
	     With two conditions live (offline and a stale nonce cache, say) both
	     pinned to the same offset, so 37px of scroll put the second bar exactly on
	     top of the first and the first was never seen again. Measured before the
	     fix: A=[48,85] and B=[48,85] from scrollY 60 onward.

	     Pinning the GROUP has no such arithmetic to get wrong. The bars keep their
	     natural order inside it, the offset is spelled once, and they arrive and
	     leave together.

	     It also takes the obligation off whoever adds the next bar. A bar is now a
	     plain `{#if condition}<div>` with no idea it is pinned, so a descendant
	     writing one cannot forget the class, cannot get the offset wrong, and does
	     not add a fifth place spelling the navbar's height.

	     `z-40` here rather than on each bar, so it is one rank against the page
	     (below the navbar's `z-50`). Within the group DOM order decides, which is
	     the same rule `context/AcrossPages.svelte` runs on. -->
	<div class="sticky top-[var(--navbar-height)] z-40">
		{#each chrome as bar (bar.name)}
			{@const Bar = bar.component}
			{#if !bar.when || bar.when({routeId: routeId()})}
				<Bar />
			{/if}
		{/each}
	</div>

	<!-- The content region. `min-h-0` is the load-bearing half: without it a flex
	     item refuses to be shorter than its content, the region grows past the
	     fold, and the shell is a decoration. `data-app-content` is the handle the
	     shell's e2e test measures, and a stable name for a descendant that has to
	     reach the region from outside the tree. -->
	<div data-app-content class="min-h-0 flex-1">
		{@render children()}
	</div>
</div>
