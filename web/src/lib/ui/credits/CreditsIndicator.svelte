<script lang="ts">
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import type {CreditsView} from './credits-view';

	let {
		view,
		onclick,
	}: {
		view: CreditsView;
		/** Opens the account panel, where the top-up action lives. */
		onclick?: () => void;
	} = $props();
</script>

<!-- Whether this shows at all, and what it says, is decided in
     ./credits-view.ts; this only renders the answer. -->
{#if view.showTopBarIndicator}
	<button
		type="button"
		{onclick}
		data-testid="signer-credits"
		data-needs-funding={view.needsFunding}
		title="{view.label}: {view.topBarText}"
		aria-label="{view.label}: {view.topBarText}"
		class="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm transition-colors {view.needsFunding
			? 'text-amber-500 hover:bg-amber-500/10'
			: 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
	>
		{#if view.needsFunding}
			<AlertCircleIcon class="h-3 w-3" />
		{:else}
			<CoinsIcon class="h-3 w-3" />
		{/if}
		{view.topBarText}
	</button>
{/if}
