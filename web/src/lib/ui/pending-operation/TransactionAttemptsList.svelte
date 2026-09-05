<script lang="ts">
	import * as Collapsible from '$lib/shadcn/ui/collapsible/index.js';
	import TransactionHash from '$lib/core/ui/ethereum/TransactionHash.svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type {OperationAttempt} from '$lib/account/AccountData';
	import {sortAttemptsNewestFirst} from '$lib/view/operation';

	interface Props {
		/** The app's own broadcasts, newest shown first. */
		attempts: OperationAttempt[];
	}

	let {attempts}: Props = $props();

	let isOpen = $state(false);

	let sortedAttempts = $derived(sortAttemptsNewestFirst(attempts));

	// Format relative time
	function formatRelativeTime(timestampMs: number | undefined): string {
		if (!timestampMs) return 'Unknown';
		const now = Date.now();
		const diffMs = now - timestampMs;
		const diffSecs = Math.floor(diffMs / 1000);
		const diffMins = Math.floor(diffSecs / 60);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffDays > 0) return `${diffDays}d ago`;
		if (diffHours > 0) return `${diffHours}h ago`;
		if (diffMins > 0) return `${diffMins}m ago`;
		return `${diffSecs}s ago`;
	}
</script>

{#if attempts.length > 1}
	<Collapsible.Root bind:open={isOpen}>
		<Collapsible.Trigger
			class="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
		>
			<span>{attempts.length} transaction attempts</span>
			<span
				class="transition-transform duration-200"
				style:transform={isOpen ? 'rotate(180deg)' : 'rotate(0deg)'}
			>
				<ChevronDownIcon class="size-4" />
			</span>
		</Collapsible.Trigger>
		<Collapsible.Content>
			<div class="mt-2 space-y-2">
				{#each sortedAttempts as tx, i}
					<div
						class="flex flex-col gap-1 rounded-md border bg-muted/30 p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
					>
						<div class="flex items-center gap-2">
							<span class="text-muted-foreground">#{i + 1}</span>
							<TransactionHash
								value={tx.hash}
								truncate={{start: 6, end: 4}}
								size="sm"
								linkTo="auto"
							/>
						</div>
						<div class="flex items-center gap-3 text-xs text-muted-foreground">
							<span>{formatRelativeTime(tx.broadcastTimestampMs)}</span>
						</div>
					</div>
				{/each}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
{:else if attempts.length === 1}
	<div class="text-sm">
		<span class="text-muted-foreground">Transaction Hash:</span>
		<div class="mt-1">
			<TransactionHash
				value={attempts[0].hash}
				truncate={{start: 8, end: 6}}
				linkTo="auto"
			/>
		</div>
	</div>
{/if}
