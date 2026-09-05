<script lang="ts">
	import type {OnchainOperation} from '$lib/account/AccountData';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import {Badge} from '$lib/shadcn/ui/badge/index.js';
	import {
		getOperationName,
		getTransactionResult,
		getEarliestBroadcastMs,
		getInclusionBadgeVariant,
		getBlockTimestamp,
		formatBroadcastTime,
		formatBlockTime,
	} from '$lib/view/operation';

	interface Props {
		operation: OnchainOperation;
	}

	let {operation}: Props = $props();

	let operationName = $derived(getOperationName(operation, 'Transaction'));

	// Get status string from the observer's state
	let status = $derived(operation.state?.inclusion || 'Fetching');

	let transactionResult = $derived(getTransactionResult(operation.state));

	// Finality is a BOOLEAN. It used to be the inclusion block's timestamp, and
	// this view printed it as "Block {final}".
	let isFinal = $derived(operation.state?.final === true);

	// The inclusion time, in the chain's own seconds, formatted next to the
	// broadcast time below. Two clocks, two units, two formatters.
	let minedTime = $derived(formatBlockTime(getBlockTimestamp(operation.state)));

	let broadcastTime = $derived(
		formatBroadcastTime(getEarliestBroadcastMs(operation)),
	);

	// The dispatch facts, which the app owns: one call, one nonce slot.
	let fromAddress = $derived(operation.call?.from ?? null);

	let nonce = $derived(operation.attempts[0]?.nonce);

	let statusVariant = $derived(getInclusionBadgeVariant(status));
</script>

<div class="space-y-4">
	<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
		<span class="text-muted-foreground">Operation:</span>
		<span class="font-medium">{operationName}</span>

		<span class="text-muted-foreground">Status:</span>
		<span>
			<Badge variant={statusVariant}>{status}</Badge>
		</span>

		{#if transactionResult}
			<span class="text-muted-foreground">Result:</span>
			<span>
				<Badge
					variant={transactionResult === 'Success' ? 'default' : 'destructive'}
				>
					{transactionResult}
				</Badge>
			</span>
		{/if}

		{#if isFinal}
			<span class="text-muted-foreground">Finality:</span>
			<span>
				<Badge variant="outline">Final</Badge>
			</span>
		{/if}

		{#if minedTime}
			<span class="text-muted-foreground">Mined:</span>
			<span>{minedTime}</span>
		{/if}

		{#if fromAddress}
			<span class="text-muted-foreground">From:</span>
			<span>
				<Address value={fromAddress} linkTo="auto" />
			</span>
		{/if}

		{#if nonce !== undefined}
			<span class="text-muted-foreground">Nonce:</span>
			<span class="font-mono">{nonce}</span>
		{/if}

		{#if broadcastTime}
			<span class="text-muted-foreground">Broadcast:</span>
			<span>{broadcastTime}</span>
		{/if}
	</div>
</div>
