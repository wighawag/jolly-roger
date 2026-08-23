<script lang="ts">
	import {getAppContext} from '$lib';
	import SendIcon from '@lucide/svelte/icons/send';
	import {createSendingState} from './sending';

	const {inFlight} = getAppContext();
	const sending = createSendingState(inFlight);
</script>

{#if $sending.sending}
	<div
		class="sticky top-12 z-40 flex w-full items-center gap-2 border-b border-amber-900 bg-amber-950 px-4 py-2"
		role="status"
		aria-live="polite"
	>
		<SendIcon class="h-4 w-4 shrink-0 animate-pulse text-amber-400" />
		<span class="text-sm text-amber-400">
			{#if $sending.count > 1}
				Sending {$sending.count} transactions. Leaving the page now means waiting
				to find out whether they went through.
			{:else}
				Sending{$sending.description ? ` ${$sending.description}` : ''}. Leaving
				the page now means waiting to find out whether it went through.
			{/if}
		</span>
	</div>
{/if}
