<script lang="ts">
	import {goto} from '$app/navigation';
	import * as Card from '$lib/shadcn/ui/card';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import TransactionHash from '$lib/core/ui/ethereum/TransactionHash.svelte';
	import type {PublicClient, Transaction, TransactionReceipt} from 'viem';
	import {formatGwei} from 'viem';
	import {
		formatDecodedTransaction,
		transactionHeadline,
		type DecodedTransactionData,
	} from '../lib/services/transactionDecoder';
	import {loadTransactionItemData} from '../lib/services/transactionItem';
	import {formatTimestamp, formatValue, getEip1559FeeInfo} from '../lib/utils';
	import {route} from '$lib';
	import {deployments} from '$lib/deployments-store';

	interface Props {
		tx: Transaction;
		blockTimestamp: number;
		publicClient: PublicClient;
	}

	let {tx, blockTimestamp, publicClient}: Props = $props();

	let decodedData = $state<DecodedTransactionData>({
		isDecoded: false,
		status: 'pending',
	});
	let formattedData = $derived(formatDecodedTransaction(decodedData));
	let loading = $state(true);
	let receipt = $state<TransactionReceipt | null>(null);

	// Track the hash we've decoded to prevent re-decoding
	let decodedHash = $state<string | null>(null);

	// What the row is listed under: the decoder's label once this transaction is
	// decoded, what it says of itself until then.
	let headline = $derived(
		transactionHeadline(tx, decodedHash === tx.hash ? decodedData : undefined),
	);

	// Load receipt + decode when tx.hash changes and we haven't decoded it yet.
	async function loadItem(hash: `0x${string}`) {
		loading = true;
		try {
			const data = await loadTransactionItemData(
				tx,
				publicClient,
				deployments.get().contracts,
			);
			receipt = data.receipt;
			decodedData = data.decodedData;
			decodedHash = hash;
		} catch (e) {
			console.error('Error decoding transaction:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const hash = tx.hash;
		if (hash && hash !== decodedHash) {
			loadItem(hash);
		}
	});

	// Navigate to transaction details page
	function viewTransaction() {
		goto(route(`/explorer/tx/${tx.hash}`));
	}

	// Navigate to address page
	function viewAddress(address: string, event: MouseEvent) {
		event.stopPropagation();
		goto(route(`/explorer/address/${address}`));
	}

	// Check if this is a contract creation transaction
	let isContractCreation = $derived(!tx.to);

	// Get contract address from receipt for contract creation transactions
	let contractAddress = $derived(
		isContractCreation && receipt?.contractAddress
			? receipt.contractAddress
			: null,
	);

	// EIP-1559 fee display info (shared with the transaction detail view).
	let feeInfo = $derived(getEip1559FeeInfo(tx, receipt));
	let isEIP1559 = $derived(feeInfo.isEIP1559);
	let maxPriorityFeePerGas = $derived(feeInfo.maxPriorityFeePerGas);
	let baseFeeUsed = $derived(feeInfo.baseFeeUsed);
</script>

<Card.Root
	class="cursor-pointer transition-colors hover:border-primary/50"
	onclick={viewTransaction}
>
	<Card.Content class="p-4">
		<div class="flex items-start justify-between gap-4">
			<!-- Left side: Transaction info -->
			<div class="min-w-0 flex-1 space-y-2">
				<!-- Transaction Hash and Status -->
				<div class="flex flex-wrap items-center gap-2">
					<TransactionHash
						value={tx.hash}
						linkTo="both"
						size="sm"
						showCopy={false}
					/>

					<!-- Status Indicator -->
					<div class="flex items-center gap-1">
						{#if loading}
							<LoaderIcon class="h-4 w-4 animate-spin text-muted-foreground" />
						{:else if decodedData.status === 'success'}
							<CheckCircleIcon class="h-4 w-4 text-green-600" />
						{:else if decodedData.status === 'failed'}
							<XCircleIcon class="h-4 w-4 text-red-600" />
						{:else}
							<LoaderIcon class="h-4 w-4 animate-spin text-yellow-600" />
						{/if}
						<span class="text-xs text-muted-foreground"
							>{formattedData.statusText}</span
						>
					</div>
				</div>

				<!-- Method/Function Name -->
				{#if headline.kind !== 'creation'}
					<div>
						<div
							class={headline.kind === 'function'
								? 'text-sm font-medium'
								: 'font-mono text-sm text-muted-foreground'}
						>
							{headline.label}
						</div>
						{#if headline.details}
							<div
								class="truncate text-xs text-muted-foreground"
								title={headline.details}
							>
								{headline.details}
							</div>
						{/if}
					</div>
				{:else}
					<div class="space-y-1">
						<div class="font-mono text-sm text-muted-foreground">
							{headline.label}
						</div>
						{#if contractAddress}
							<div class="flex items-center gap-1 text-xs">
								<span class="text-muted-foreground">Created:</span>
								<Address
									value={contractAddress}
									linkTo="both"
									showCopy={false}
								/>
							</div>
						{:else if loading}
							<div
								class="flex items-center gap-1 text-xs text-muted-foreground"
							>
								<LoaderIcon class="h-3 w-3 animate-spin" />
								<span>Loading contract address...</span>
							</div>
						{/if}
					</div>
				{/if}

				<!-- From/To Addresses -->
				<div class="flex flex-wrap items-center gap-3 text-xs">
					<div class="flex items-center gap-1">
						<span class="text-muted-foreground">From:</span>
						<Address value={tx.from} linkTo="both" size="xs" />
					</div>
					{#if tx.to}
						<div class="flex items-center gap-1">
							<span class="text-muted-foreground">To:</span>
							<Address value={tx.to} linkTo="both" size="xs" />
						</div>
					{/if}
				</div>
			</div>

			<!-- Right side: Block info and value -->
			<div class="shrink-0 space-y-2 text-right">
				<!-- Block Number -->
				<div>
					<div class="text-xs text-muted-foreground">Block</div>
					<div class="font-mono text-sm">{Number(tx.blockNumber)}</div>
				</div>

				<!-- Value -->
				{#if tx.value > 0n}
					<div>
						<div class="text-xs text-muted-foreground">Value</div>
						<div class="font-mono text-sm font-medium">
							{formatValue(tx.value)}
						</div>
					</div>
				{/if}

				<!-- Type and Fee Info -->
				{#if isEIP1559}
					<div class="space-y-1">
						<div class="flex items-center justify-end gap-1">
							<ZapIcon class="h-4 w-4 text-muted-foreground" />
							<span class="text-xs text-muted-foreground">EIP-1559</span>
						</div>
						{#if baseFeeUsed !== null}
							<div>
								<div class="text-xs text-muted-foreground">Base Fee</div>
								<div class="font-mono text-xs">
									{formatGwei(baseFeeUsed)} Gwei
								</div>
							</div>
						{/if}
						{#if maxPriorityFeePerGas !== null}
							<div>
								<div class="text-xs text-muted-foreground">Priority Fee</div>
								<div class="font-mono text-xs">
									{formatGwei(maxPriorityFeePerGas)} Gwei
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<FileTextIcon class="mx-auto mt-1 h-4 w-4 text-muted-foreground" />
				{/if}
			</div>
		</div>

		<!-- Timestamp -->
		<div class="mt-3 border-t pt-3">
			<div class="text-xs text-muted-foreground">
				{formatTimestamp(blockTimestamp)}
			</div>
		</div>
	</Card.Content>
</Card.Root>
