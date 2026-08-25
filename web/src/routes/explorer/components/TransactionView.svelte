<script lang="ts">
	// Decoded arguments carry bigints for every uint/int parameter, and
	// JSON.stringify throws on one. See core/utils/format/json.
	import {bigIntReplacer} from '$lib/core/utils/format/json';
	import DefaultHead from '$lib/metadata/DefaultHead.svelte';
	import {getAppContext} from '$lib';
	import * as Card from '$lib/shadcn/ui/card';
	import * as Alert from '$lib/shadcn/ui/alert';
	import * as Separator from '$lib/shadcn/ui/separator';
	import {Button} from '$lib/shadcn/ui/button';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import * as Empty from '$lib/shadcn/ui/empty';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import HashIcon from '@lucide/svelte/icons/hash';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import TransactionHash from '$lib/core/ui/ethereum/TransactionHash.svelte';
	import {formatGwei} from 'viem';
	import {
		formatGas,
		formatGasPrice,
		formatValue,
		formatTxStatus,
		findContractByAddress,
		formatPreciseTimestamp,
		formatTimestamp,
		getBlockExplorerTxUrl,
		getEip1559FeeInfo,
		hasBlockExplorer,
	} from '../lib/utils';
	import {getTransactionDetailsStore} from '../lib/stores/transactionDetails';
	import {formatDecodedTransaction} from '../lib/services/transactionDecoder';

	interface Props {
		txHash: `0x${string}` | null;
	}

	let {txHash}: Props = $props();

	let {publicClient} = getAppContext();

	// All fetching / decoding lives in the store.
	const details = getTransactionDetailsStore({publicClient});
	let tx = $derived($details.tx);
	let receipt = $derived($details.receipt);
	let block = $derived($details.block);
	let loading = $derived($details.loading);
	let error = $derived($details.error);
	let decodedEvents = $derived($details.decodedEvents);
	let decodedTxData = $derived($details.decodedTxData);
	let formattedTxData = $derived(formatDecodedTransaction(decodedTxData));

	// Fetch when txHash changes
	$effect(() => {
		details.fetch(txHash);
	});
</script>

<DefaultHead title={'Transaction Explorer'} />

<div class="container mx-auto max-w-5xl px-4 py-8">
	{#if !txHash}
		<Empty.Root class="min-h-100">
			<Empty.Header>
				<Empty.Media variant="icon">
					<HashIcon />
				</Empty.Media>
				<Empty.Title>No Transaction Hash</Empty.Title>
				<Empty.Description>
					Provide a transaction hash in the URL to view its details.
					<br />
					Example:
					<code class="rounded bg-muted px-1 text-xs">/explorer/tx/0x...</code>
				</Empty.Description>
			</Empty.Header>
			<Button onclick={() => window.history.back()} variant="outline">
				<ArrowLeftIcon class="mr-2 h-4 w-4" />
				Go Back
			</Button>
		</Empty.Root>
	{:else if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<Spinner />
			<p class="mt-4 text-muted-foreground">Loading transaction...</p>
		</div>
	{:else if error}
		<Alert.Root variant="destructive">
			<XCircleIcon class="h-4 w-4" />
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{:else if !tx || !receipt}
		<Empty.Root class="min-h-100">
			<Empty.Header>
				<Empty.Media variant="icon">
					<HashIcon />
				</Empty.Media>
				<Empty.Title>Transaction Not Found</Empty.Title>
				<Empty.Description>
					The transaction hash {txHash} could not be found on the blockchain.
				</Empty.Description>
			</Empty.Header>
			<Button onclick={() => window.history.back()} variant="outline">
				<ArrowLeftIcon class="mr-2 h-4 w-4" />
				Go Back
			</Button>
		</Empty.Root>
	{:else}
		<div class="space-y-6">
			<!-- Header -->
			<div
				class="flex flex-col justify-between gap-4 md:flex-row md:items-center"
			>
				<div class="flex-1">
					<!-- Transaction Method/Function -->
					{#if decodedTxData.isDecoded && formattedTxData.methodLabel}
						<div class="text-2xl font-bold">{formattedTxData.methodLabel}</div>
						{#if formattedTxData.methodDetails}
							<div
								class="truncate text-sm text-muted-foreground"
								title={formattedTxData.methodDetails}
							>
								{formattedTxData.methodDetails}
							</div>
						{/if}
					{:else if tx.to}
						<div class="text-2xl font-bold">Contract Call</div>
					{:else}
						<div class="text-2xl font-bold">Contract Creation</div>
					{/if}

					<!-- Transaction Hash -->
					<div class="mt-1 flex items-center gap-2">
						<TransactionHash value={txHash} linkTo="both" />
					</div>

					<!-- Transaction Status -->
					<div class="mt-2 flex items-center gap-2">
						{#if decodedTxData.status === 'success'}
							<div class="flex items-center gap-1 text-sm text-green-600">
								<CheckCircleIcon class="h-4 w-4" />
								<span class="font-semibold">Success</span>
							</div>
						{:else if decodedTxData.status === 'failed'}
							<div class="flex items-center gap-1 text-sm text-red-600">
								<XCircleIcon class="h-4 w-4" />
								<span class="font-semibold">Failed</span>
								{#if decodedTxData.error}
									<span class="text-sm text-muted-foreground"
										>- {decodedTxData.error}</span
									>
								{/if}
							</div>
						{:else}
							<div class="flex items-center gap-1 text-sm text-yellow-600">
								<XCircleIcon class="h-4 w-4 animate-spin" />
								<span class="font-semibold">Pending</span>
							</div>
						{/if}
					</div>
				</div>
				<div class="flex gap-2">
					{#if hasBlockExplorer() && txHash}
						{@const explorerUrl = getBlockExplorerTxUrl(txHash)}
						{#if explorerUrl}
							<Button
								href={explorerUrl}
								target="_blank"
								rel="noopener noreferrer"
								variant="outline"
								size="sm"
							>
								<ExternalLinkIcon class="mr-2 h-4 w-4" />
								View in Explorer
							</Button>
						{/if}
					{/if}
					<Button
						onclick={() => window.history.back()}
						variant="outline"
						size="sm"
					>
						<ArrowLeftIcon class="mr-2 h-4 w-4" />
						Back
					</Button>
				</div>
			</div>

			<Separator.Root />

			<!-- Function Arguments (if decoded) -->
			{#if decodedTxData.isDecoded && decodedTxData.args}
				<Card.Root>
					<Card.Header>
						<Card.Title>Function Arguments</Card.Title>
					</Card.Header>
					<Card.Content>
						<pre
							class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"><code
								>{JSON.stringify(decodedTxData.args, bigIntReplacer, 2)}</code
							></pre>
					</Card.Content>
				</Card.Root>
			{/if}

			<!-- Error Details (if transaction failed) -->
			{#if decodedTxData.status === 'failed' && (decodedTxData.error || decodedTxData.decodedError)}
				<Card.Root class="border-red-500/50 bg-red-50/50 dark:bg-red-950/20">
					<Card.Header>
						<div class="flex items-center gap-2 text-red-600 dark:text-red-400">
							<AlertTriangleIcon class="h-5 w-5" />
							<Card.Title class="text-red-600 dark:text-red-400"
								>Transaction Error</Card.Title
							>
						</div>
					</Card.Header>
					<Card.Content class="space-y-4">
						{#if decodedTxData.decodedError}
							<div>
								<div class="text-sm font-medium text-muted-foreground">
									Error Name
								</div>
								<div
									class="font-mono text-lg font-semibold text-red-600 dark:text-red-400"
								>
									{decodedTxData.decodedError.errorName}
								</div>
							</div>
							{#if decodedTxData.decodedError.args}
								<div>
									<div class="mb-2 text-sm font-medium text-muted-foreground">
										Error Arguments
									</div>
									<pre
										class="overflow-x-auto rounded-md bg-red-100/50 p-3 font-mono text-xs dark:bg-red-900/30"><code
											>{JSON.stringify(
												decodedTxData.decodedError.args,
												bigIntReplacer,
												2,
											)}</code
										></pre>
								</div>
							{/if}
							{#if decodedTxData.decodedError.rawData}
								<div>
									<div class="mb-2 text-sm font-medium text-muted-foreground">
										Raw Error Data
									</div>
									<pre
										class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap"><code
											>{decodedTxData.decodedError.rawData}</code
										></pre>
								</div>
							{/if}
						{:else if decodedTxData.error}
							<div>
								<div class="text-sm font-medium text-muted-foreground">
									Error Message
								</div>
								<div class="font-mono text-red-600 dark:text-red-400">
									{decodedTxData.error}
								</div>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}

			<!-- Transaction Details -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Transaction</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="grid gap-4 md:grid-cols-2">
						<div>
							<div class="text-sm font-medium text-muted-foreground">
								Block Number
							</div>
							{#if receipt}
								<div class="font-mono">{Number(receipt.blockNumber)}</div>
							{:else}
								<div class="font-mono text-yellow-600">Pending</div>
							{/if}
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">
								Timestamp
							</div>
							{#if block}
								<div class="font-mono">
									{formatPreciseTimestamp(Number(block.timestamp))}
								</div>
								<div class="text-xs text-muted-foreground">
									({formatTimestamp(Number(block.timestamp))})
								</div>
							{:else if !receipt}
								<div class="font-mono text-muted-foreground">Loading...</div>
							{:else}
								<div class="font-mono text-yellow-600">Pending</div>
							{/if}
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">
								Status
							</div>
							{#if receipt}
								<div class="font-mono">{formatTxStatus(receipt.status)}</div>
							{:else}
								<div class="font-mono text-yellow-600">Pending</div>
							{/if}
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">From</div>
							<div class="font-mono">
								<Address value={tx.from} linkTo="both" />
							</div>
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">To</div>
							{#if tx.to}
								<div class="font-mono">
									<Address value={tx.to} linkTo="both" />
								</div>
							{:else}
								<div class="font-mono text-muted-foreground">
									Contract Creation
								</div>
							{/if}
						</div>
						{#if !tx.to && receipt?.contractAddress}
							<div>
								<div class="text-sm font-medium text-muted-foreground">
									Created Contract
								</div>
								<div class="font-mono">
									<Address value={receipt.contractAddress} linkTo="both" />
								</div>
							</div>
						{/if}
						<div>
							<div class="text-sm font-medium text-muted-foreground">Value</div>
							<div class="font-mono">{formatValue(tx.value)}</div>
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">
								Gas Used
							</div>
							<div class="font-mono">
								{formatGas(receipt.gasUsed)} / {formatGas(tx.gas)}
							</div>
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">
								Gas Price
							</div>
							<div class="font-mono">
								{formatGasPrice(receipt.effectiveGasPrice)}
							</div>
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">Type</div>
							<div class="font-mono">
								{tx.type || 'Legacy'}
							</div>
						</div>
						{#if tx.type === 'eip1559'}
							{@const feeInfo = getEip1559FeeInfo(tx, receipt)}
							{@const maxPriorityFee = feeInfo.maxPriorityFeePerGas}
							{@const baseFeeUsed = feeInfo.baseFeeUsed}
							{#if baseFeeUsed !== null}
								<div>
									<div class="text-sm font-medium text-muted-foreground">
										Base Fee
									</div>
									<div class="font-mono">{formatGwei(baseFeeUsed)} Gwei</div>
								</div>
							{/if}
							{#if maxPriorityFee !== null}
								<div>
									<div class="text-sm font-medium text-muted-foreground">
										Priority Fee
									</div>
									<div class="font-mono">{formatGwei(maxPriorityFee)} Gwei</div>
								</div>
							{/if}
							{#if 'maxFeePerGas' in tx && tx.maxFeePerGas}
								<div>
									<div class="text-sm font-medium text-muted-foreground">
										Max Fee Per Gas
									</div>
									<div class="font-mono">
										{formatGwei(tx.maxFeePerGas as bigint)} Gwei
									</div>
								</div>
							{/if}
						{/if}
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Events -->
			{#if receipt.logs.length > 0}
				<Card.Root>
					<Card.Header>
						<div class="flex items-center gap-2">
							<FileCodeIcon class="h-5 w-5" />
							<Card.Title>Events ({receipt.logs.length})</Card.Title>
						</div>
					</Card.Header>
					<Card.Content>
						{#if decodedEvents.length === 0}
							<div class="space-y-4">
								{#each receipt.logs as log, i}
									<div class="rounded-lg bg-muted/50 p-4">
										<div class="mb-2 text-sm font-medium text-muted-foreground">
											Log #{i + 1}
										</div>
										<div class="grid gap-2 text-sm">
											<div>
												<span class="font-medium text-muted-foreground"
													>Address:</span
												>
												<span class="ml-2 font-mono"
													><Address value={log.address} linkTo="both" /></span
												>
											</div>
											<div>
												<span class="font-medium text-muted-foreground"
													>Topics:</span
												>
												<pre
													class="mt-1 rounded bg-background p-2 font-mono text-xs">{JSON.stringify(
														log.topics,
														bigIntReplacer,
														2,
													)}</pre>
											</div>
											<div>
												<span class="font-medium text-muted-foreground"
													>Data:</span
												>
												<pre
													class="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs">{log.data}</pre>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="space-y-4">
								{#each decodedEvents as event}
									{@const contractInfo = findContractByAddress(event.address)}
									<div class="rounded-lg border p-4">
										<div class="mb-2 flex items-start justify-between">
											<div>
												<div class="text-lg font-semibold">
													{event.eventName}
												</div>
												{#if contractInfo}
													<div class="text-sm text-muted-foreground">
														Contract: {contractInfo.name}
													</div>
												{/if}
											</div>
											<Address value={event.address} linkTo="both" />
										</div>
										<Separator.Root class="my-3" />
										<div class="grid gap-3">
											<div class="text-sm">
												<span class="font-medium text-muted-foreground"
													>Block:</span
												>
												<span class="ml-2 font-mono"
													>{Number(event.blockNumber)}</span
												>
											</div>
											<div class="text-sm">
												<span class="font-medium text-muted-foreground"
													>Transaction:</span
												>
												<span class="ml-2 font-mono"
													><TransactionHash
														value={event.txHash as `0x${string}`}
														linkTo="both"
													/></span
												>
											</div>
											<div>
												<div
													class="mb-2 text-sm font-medium text-muted-foreground"
												>
													Parameters
												</div>
												<pre
													class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"><code
														>{JSON.stringify(
															event.args,
															bigIntReplacer,
															2,
														)}</code
													></pre>
											</div>
										</div>
									</div>
								{/each}

								{#if decodedEvents.length < receipt.logs.length}
									<Alert.Root>
										<FileCodeIcon class="h-4 w-4" />
										<Alert.Description>
											{receipt.logs.length - decodedEvents.length} additional logs
											could not be decoded (unknown contracts)
										</Alert.Description>
									</Alert.Root>
								{/if}
							</div>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	{/if}
</div>
