<script lang="ts">
	import DefaultHead from '$lib/metadata/DefaultHead.svelte';
	import {getAppContext} from '$lib';
	import * as Empty from '$lib/shadcn/ui/empty';
	import * as Separator from '$lib/shadcn/ui/separator';
	import ListIcon from '@lucide/svelte/icons/list';
	import OperationCard from './components/OperationCard.svelte';
	import {sortOperationIdsDescending} from '$lib/view/operation';

	const {accountData} = getAppContext();

	const lifecycle = accountData.lifecycle$;
	let operationIds = $derived(accountData.watchItemIds('operations'));
	let sortedOperationIds = $derived(sortOperationIdsDescending($operationIds));
</script>

<DefaultHead title={'Transactions'} />

<div class="container mx-auto max-w-5xl px-4 py-8">
	<div class="space-y-6">
		<div class="flex flex-col items-center space-y-2">
			<div class="rounded-full bg-primary/10 p-3">
				<ListIcon class="h-8 w-8 text-primary" />
			</div>
			<h1 class="text-3xl font-bold">Transactions</h1>
			<p class="text-muted-foreground">
				Track your pending transactions and those awaiting finality
			</p>
		</div>

		<Separator.Root />

		{#if $lifecycle.status === 'no-account'}
			<Empty.Root class="min-h-100">
				<Empty.Header>
					<Empty.Media variant="icon">
						<ListIcon />
					</Empty.Media>
					<Empty.Title>No Account Connected</Empty.Title>
					<Empty.Description>
						Connect your wallet to view your transactions.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if $lifecycle.status === 'error'}
			<Empty.Root class="min-h-100">
				<Empty.Header>
					<Empty.Media variant="icon">
						<ListIcon />
					</Empty.Media>
					<Empty.Title>Transactions Could Not Be Loaded</Empty.Title>
					<Empty.Description>
						{$lifecycle.error.message}
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if $lifecycle.status === 'loading'}
			<div class="flex flex-col items-center justify-center py-12">
				<div
					class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
				></div>
				<p class="mt-4 text-muted-foreground">Loading transactions...</p>
			</div>
		{:else if $operationIds.length === 0}
			<Empty.Root class="min-h-100">
				<Empty.Header>
					<Empty.Media variant="icon">
						<ListIcon />
					</Empty.Media>
					<Empty.Title>No Pending Transaction</Empty.Title>
					<Empty.Description>
						Note that Completed Successful transactions are automatically
						removed once finalized.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			<div class="space-y-4">
				{#each sortedOperationIds as id (id)}
					<OperationCard
						{id}
						operationStore={accountData.watchItem('operations', id)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>
