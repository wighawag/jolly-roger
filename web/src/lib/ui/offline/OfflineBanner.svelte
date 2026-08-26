<script lang="ts">
	import {getAppContext} from '$lib';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';

	const {offline} = getAppContext();
</script>

{#if $offline.offline}
	<div
		data-testid="offline-banner"
		class="flex w-full items-center gap-2 border-b border-red-900 bg-red-950 px-4 py-2"
	>
		<CloudOffIcon class="h-4 w-4 shrink-0 text-red-400" />
		<span class="text-sm text-red-400">
			You are offline. Some features may be unavailable until connectivity is
			restored.
		</span>
	</div>
{/if}
