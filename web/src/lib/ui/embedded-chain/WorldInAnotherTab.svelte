<!--
	THE WORLD IS OPEN IN ANOTHER TAB: what a tab shows when it may not boot the
	world, and the two ways on from there.

	ONE COPY FOR EVERY WORLD-OWNING ROUTE, which is why it is a component rather
	than markup in a route. The rule it renders is `$lib/embedded/claim`'s and is
	the same for every app; a copy per route would be the same three states
	drifting apart one wording at a time.

	IT RENDERS NOTHING WHILE THIS TAB HOLDS THE WORLD, or before it has asked, so
	a route places it above the world and lets it decide. The route still has to
	put the world's own branch AFTER it: `LettingGo` is this tab handing the world
	over, and the world's subtree must unmount for its writers to stop.
-->
<script lang="ts">
	import type {WorldClaim} from '$lib/embedded/claim';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {Spinner} from '$lib/shadcn/ui/spinner';

	const {
		claim,
		onTakeOver,
		home,
	}: {
		/** The claim this route's world is guarded by. */
		claim: WorldClaim;
		/** Take the world over, and boot it here once it is this tab's. */
		onTakeOver: () => void;
		/** Where "Go back" goes: the app's home. */
		home: string;
	} = $props();
</script>

{#if $claim.step === 'Refused'}
	<div
		data-testid="world-in-another-tab"
		class="container mx-auto max-w-2xl px-4 py-24 text-center"
	>
		<h1 class="text-lg font-semibold">This world is open in another tab.</h1>
		<p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
			A world lives in this browser, and only one tab may play it at a time: two
			would each keep their own copy of its chain, and the copies would stop
			being one world. Take it over here, and the other tab lets it go.
		</p>
		<div class="mt-6 flex flex-wrap justify-center gap-2">
			<Button data-testid="take-the-world-over" onclick={onTakeOver}
				>Take it over here</Button
			>
			<Button variant="outline" href={home}>Go back</Button>
		</div>
	</div>
{:else if $claim.step === 'Waiting'}
	<div
		data-testid="world-waiting-for-other-tab"
		class="container mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center"
	>
		<Spinner class="size-6" />
		<p class="text-sm text-muted-foreground">
			Waiting for the other tab to let the world go&hellip;
		</p>
		<Button variant="outline" href={home} onclick={() => claim.abandon()}
			>Go back</Button
		>
	</div>
{:else if $claim.step === 'LettingGo'}
	<div
		data-testid="world-handed-over"
		class="container mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center"
	>
		<Spinner class="size-6" />
		<p class="text-sm text-muted-foreground">
			Another tab asked for this world. Saving it and handing it over&hellip;
		</p>
	</div>
{/if}
