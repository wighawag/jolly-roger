<script lang="ts">
	import {getAppContext, route} from '$lib';
	import * as Card from '$lib/shadcn/ui/card';
	import {Badge} from '$lib/shadcn/ui/badge';
	import {Button} from '$lib/shadcn/ui/button';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-help';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type {OnchainOperation} from '$lib/account/AccountData';
	import type {Readable} from 'svelte/store';
	import {pendingOperationOverlay} from '$lib/ui/pending-operation';
	import TransactionHash from '$lib/core/ui/ethereum/TransactionHash.svelte';
	import {
		getOperationName,
		getOperationStatusInfo,
		getMainTxHash,
		type OperationStatusKind,
	} from '$lib/view/operation';

	interface Props {
		id: string;
		operationStore: Readable<OnchainOperation | undefined>;
	}

	let {id, operationStore}: Props = $props();

	// Opening puts the operation id in the URL, so the inspector is addressable
	// and the back gesture closes it (ADR-0004, `work` branch).
	const inspector = getAppContext().overlays.use(pendingOperationOverlay);

	// Map the semantic status kind to an icon component (presentation only).
	const statusIcons: Record<OperationStatusKind, typeof CircleCheckIcon> = {
		pending: ClockIcon,
		notFound: CircleQuestionMarkIcon,
		dropped: TriangleAlertIcon,
		success: CircleCheckIcon,
		failed: CircleXIcon,
		unknown: CircleQuestionMarkIcon,
	};

	// Helper to get block explorer URL
	function getExplorerTxUrl(hash: string): string {
		return route(`/explorer/tx/${hash}`);
	}

	// Format timestamp
	function formatTimestamp(timestampMs: number): string {
		const date = new Date(timestampMs);
		return date.toLocaleString();
	}
</script>

{#if $operationStore}
	{@const statusInfo = getOperationStatusInfo(
		$operationStore.transactionIntent,
	)}
	{@const StatusIcon = statusIcons[statusInfo.kind]}
	{@const txHash = getMainTxHash($operationStore.transactionIntent)}
	{@const state = $operationStore.transactionIntent.state}
	{@const firstTx = $operationStore.transactionIntent.transactions[0]}

	<Card.Root>
		<Card.Header class="pb-2">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<StatusIcon class="h-5 w-5" />
					<Card.Title class="text-lg">
						{getOperationName($operationStore)}
					</Card.Title>
				</div>
				<div class="flex items-center gap-2">
					{#if state?.final !== undefined}
						<Badge variant="outline">Final</Badge>
					{/if}
					<Badge variant={statusInfo.variant}>
						{statusInfo.label}
					</Badge>
				</div>
			</div>
			{#if firstTx}
				<Card.Description>
					{formatTimestamp(firstTx.broadcastTimestampMs)}
				</Card.Description>
			{/if}
		</Card.Header>

		<Card.Content>
			<div class="space-y-3">
				<!-- Transaction Details -->
				{#if $operationStore.transactionIntent.transactions.length === 1 && txHash}
					<div class="flex items-center gap-2 text-sm">
						<span class="text-muted-foreground">Transaction:</span>
						<span class="ml-2 font-mono"
							><TransactionHash value={txHash} linkTo="auto" /></span
						>
					</div>
				{:else if $operationStore.transactionIntent.transactions.length > 1}
					<div class="text-sm text-muted-foreground">
						{$operationStore.transactionIntent.transactions.length} transaction attempts
					</div>
					<div class="space-y-1">
						{#each $operationStore.transactionIntent.transactions as tx, i}
							<div class="flex items-center gap-2 text-sm">
								<span class="text-muted-foreground">#{i + 1}:</span>
								<TransactionHash
									value={tx.hash}
									truncate={{start: 6, end: 4}}
									size="sm"
									linkTo="auto"
								/>
								{#if state?.inclusion === 'Included' && state.attemptIndex === i}
									<Badge variant="default" class="text-xs">Included</Badge>
									<a
										href={getExplorerTxUrl(tx.hash)}
										class="inline-flex items-center gap-1 text-primary hover:underline"
									>
										<ExternalLinkIcon class="h-4 w-4" />
										View
									</a>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<!-- Finality info -->
				{#if state?.final !== undefined}
					<div class="text-sm text-muted-foreground">
						Finalized at block {state.final}
					</div>
				{/if}

				<!-- Operation metadata args -->
				{#if $operationStore.metadata.type === 'functionCall' && $operationStore.metadata.args && $operationStore.metadata.args.length > 0}
					<details class="text-sm">
						<summary
							class="cursor-pointer text-muted-foreground hover:text-foreground"
						>
							Show arguments ({$operationStore.metadata.args.length})
						</summary>
						<pre
							class="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(
								$operationStore.metadata.args,
								null,
								2,
							)}</pre>
					</details>
				{/if}
			</div>
		</Card.Content>

		<Card.Footer class="flex justify-end gap-2">
			<Button variant="outline" size="sm" onclick={() => inspector.open(id)}>
				<SearchIcon class="mr-1 h-4 w-4" />
				Inspect
			</Button>
		</Card.Footer>
	</Card.Root>
{/if}
