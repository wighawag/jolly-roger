<script lang="ts">
	import * as Card from '$lib/shadcn/ui/card';
	import * as Alert from '$lib/shadcn/ui/alert';
	import * as Separator from '$lib/shadcn/ui/separator';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import * as Empty from '$lib/shadcn/ui/empty';
	import {Button} from '$lib/shadcn/ui/button';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import HashIcon from '@lucide/svelte/icons/hash';
	import {PUBLIC_EXPLORER_BLOCK_INDEX_ENABLED} from '$env/static/public';
	import {getTransactionListStore} from '../lib/stores/transactionList';
	import {getAppContext} from '$lib';
	import TransactionItem from './TransactionItem.svelte';

	interface Props {
		targetCount?: number;
	}

	let {targetCount = 20}: Props = $props();

	// Get publicClient from context - it doesn't change so no need for $derived
	const {publicClient, canReadChain, connection} = getAppContext();

	// Create store with publicClient in constructor
	const transactionListStore = getTransactionListStore({
		publicClient,
		useBlockIndex: PUBLIC_EXPLORER_BLOCK_INDEX_ENABLED === 'true',
	});

	// Subscribe to store state
	let storeState = $derived($transactionListStore);
	let transactions = $derived(storeState.transactions);
	let detailedTransactions = $derived(storeState.detailedTransactions);
	let loading = $derived(storeState.loading);
	let loadingDetails = $derived(storeState.loadingDetails);
	let error = $derived(storeState.error);
	let lastBlockNumber = $derived(storeState.lastBlockNumber);

	// Only fetch once we can actually read the chain (app RPC, or a connected
	// wallet that supplies one). Without this, an unconfigured/disconnected app
	// would fire calls that fail and surface as an error instead of prompting the
	// user to connect.
	let canRead = $derived($canReadChain);

	// Fetch transactions on mount (once), gated on chain readability.
	let hasFetched = false;
	$effect(() => {
		if (canRead && !hasFetched && transactions.length === 0 && !loading) {
			hasFetched = true;
			transactionListStore.fetchTransactions(targetCount);
		}
	});

	// Refresh transactions
	function refresh() {
		transactionListStore.refresh();
	}
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<ClockIcon class="h-5 w-5 text-muted-foreground" />
				<Card.Title>Recent Transactions</Card.Title>
				{#if lastBlockNumber}
					<span class="text-sm text-muted-foreground"
						>Latest Block: {Number(lastBlockNumber)}</span
					>
				{/if}
			</div>
			<button
				class="flex items-center gap-1 text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
				disabled={loading}
				onclick={refresh}
			>
				<RefreshCwIcon class="h-4 w-4 {loading ? 'animate-spin' : ''}" />
				Refresh
			</button>
		</div>
	</Card.Header>
	<Card.Content>
		{#if !canRead && transactions.length === 0}
			<Empty.Root class="min-h-50">
				<Empty.Header>
					<Empty.Media variant="icon">
						<HashIcon />
					</Empty.Media>
					<Empty.Title>Connect to load transactions</Empty.Title>
					<Empty.Description>
						Connect your wallet to fetch recent transactions from the network.
					</Empty.Description>
				</Empty.Header>
				<Button class="mt-2" onclick={() => connection.connect()}>
					Connect Wallet
				</Button>
			</Empty.Root>
		{:else if loading}
			<div class="flex flex-col items-center justify-center py-12">
				<Spinner />
				<p class="mt-4 text-muted-foreground">Loading transactions...</p>
			</div>
		{:else if error}
			<Alert.Root variant="destructive">
				<p>{error}</p>
			</Alert.Root>
		{:else if transactions.length === 0}
			<Empty.Root class="min-h-50">
				<Empty.Header>
					<Empty.Media variant="icon">
						<HashIcon />
					</Empty.Media>
					<Empty.Title>No Transactions Found</Empty.Title>
					<Empty.Description>
						There are no recent transactions on this network yet.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if loadingDetails || detailedTransactions.length === 0}
			<div class="flex flex-col items-center justify-center py-12">
				<Spinner />
				<p class="mt-4 text-muted-foreground">Loading transaction details...</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each detailedTransactions as { tx, blockTimestamp } (tx.hash)}
					<TransactionItem {tx} {blockTimestamp} {publicClient} />
				{/each}
			</div>

			{#if transactions.length < targetCount}
				<Separator.Root class="my-4" />
				<p class="text-center text-sm text-muted-foreground">
					Showing {transactions.length} of up to {targetCount} recent transactions
				</p>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
