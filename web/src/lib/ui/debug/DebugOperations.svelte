<script lang="ts">
	import {getAppContext} from '$lib';
	import {Badge} from '$lib/shadcn/ui/badge';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DebugOperationItem from './DebugOperationItem.svelte';
	import {sortOperationIdsDescending} from '$lib/view/operation';

	const {accountData} = getAppContext();

	let expanded = $state(false);

	let accountDataState = $derived(accountData.state$);
	let operationIds = $derived(accountData.watchItemIds('operations'));
	let sortedOperationIds = $derived(sortOperationIdsDescending($operationIds));
	let operationCount = $derived($operationIds?.length || 0);

	function toggleExpanded() {
		expanded = !expanded;
	}
</script>

<div class="fixed bottom-4 left-4 z-50">
	<div
		class="max-w-70 min-w-50 overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80"
	>
		<!-- Header / Toggle button -->
		<button
			onclick={toggleExpanded}
			class="flex w-full items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-muted/50"
		>
			<div class="flex items-center gap-2">
				<span class="text-xs font-medium">Transactions</span>
				{#if operationCount > 0}
					<Badge variant="secondary" class="h-4 px-1.5 py-0 text-[10px]">
						{operationCount}
					</Badge>
				{/if}
			</div>
			{#if expanded}
				<ChevronDownIcon class="h-4 w-4" />
			{:else}
				<ChevronUpIcon class="h-4 w-4" />
			{/if}
		</button>

		<!-- Expanded list -->
		{#if expanded}
			<div class="max-h-75 overflow-y-auto border-t">
				{#if $accountDataState.status === 'idle'}
					<div class="px-3 py-2 text-xs text-muted-foreground">
						No account connected
					</div>
				{:else if $accountDataState.status === 'error'}
					<div class="px-3 py-2 text-xs text-destructive">
						Could not load: {$accountDataState.loadError.message}
					</div>
				{:else if $accountDataState.isLoading}
					<div class="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
				{:else if operationCount == 0}
					<div class="px-3 py-2 text-xs text-muted-foreground">
						No transactions
					</div>
				{:else}
					<div class="divide-y">
						{#each sortedOperationIds as id (id)}
							<DebugOperationItem
								operationStore={accountData.watchItem('operations', id)}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
