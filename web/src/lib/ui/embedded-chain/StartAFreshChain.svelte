<!--
	START A FRESH CHAIN: the button that throws a chain in this tab away and
	starts a new one, and the question it asks first.

	IT ASKS, because what it throws away cannot be got back: the chain, what was
	sent on it, and the account and balance the world handed the player. The
	reset itself is the route's (`onConfirm`, usually its app's
	`$lib/embedded/reset`); this is only the press and the confirmation.

	`thing` names what is thrown away in the question ("its greetings", "the
	game"), so a route says it in its own words.
-->
<script lang="ts">
	import {Button} from '$lib/shadcn/ui/button/index.js';

	const {
		onConfirm,
		thing = 'everything on it',
	}: {
		/** Stop, forget and boot again. Called once the player has confirmed. */
		onConfirm: () => void;
		/** What the chain holds that the player loses, for the question. */
		thing?: string;
	} = $props();

	let confirming = $state(false);
</script>

{#if confirming}
	<div
		data-testid="confirm-fresh-chain"
		class="mx-auto mt-2 flex max-w-xl flex-col items-center gap-2"
	>
		<p class="font-semibold">Start a fresh chain?</p>
		<p class="text-muted-foreground">
			This throws away the test chain in this tab and {thing}. Your real account
			in the navbar is not affected.
		</p>
		<div class="flex flex-wrap justify-center gap-2">
			<Button
				size="sm"
				variant="destructive"
				data-testid="confirm-start-fresh-chain"
				onclick={() => {
					confirming = false;
					onConfirm();
				}}>Start a fresh chain</Button
			>
			<Button size="sm" variant="outline" onclick={() => (confirming = false)}
				>Cancel</Button
			>
		</div>
	</div>
{:else}
	<Button
		size="sm"
		variant="outline"
		class="ml-2 h-7"
		data-testid="start-fresh-chain"
		onclick={() => (confirming = true)}>Start a fresh chain</Button
	>
{/if}
