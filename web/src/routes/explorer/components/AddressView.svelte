<script lang="ts">
	import DefaultHead from '$lib/metadata/DefaultHead.svelte';
	import {getAppContext} from '$lib';
	import * as Card from '$lib/shadcn/ui/card';
	import * as Alert from '$lib/shadcn/ui/alert';
	import * as Separator from '$lib/shadcn/ui/separator';
	import {Button} from '$lib/shadcn/ui/button';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import * as Empty from '$lib/shadcn/ui/empty';
	import {
		Root as Tabs,
		Content as TabsContent,
		List as TabsList,
		Trigger as TabsTrigger,
	} from '$lib/shadcn/ui/tabs';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import ChevronsDownIcon from '@lucide/svelte/icons/chevrons-down';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import ContractFunction from '../../contracts/components/ContractFunction.svelte';
	import {isViewFunction} from '../../contracts/lib/utils';
	import {
		isContract,
		formatBytecode,
		getBlockExplorerAddressUrl,
		hasBlockExplorer,
	} from '../lib/utils';
	import {getAddressDataStore} from '../lib/stores/addressData';
	import {formatEther} from 'viem';

	interface Props {
		address: `0x${string}` | null;
	}

	let {address}: Props = $props();

	let {
		publicClient,
		accountExecutor,
		accountCannotSend,
		connection,
		deployments,
		balanceCheck,
	} = getAppContext();

	// All fetching / contract resolution lives in the store.
	const addressData = getAddressDataStore({publicClient});
	let balance = $derived($addressData.balance);
	let nonce = $derived($addressData.nonce);
	let code = $derived($addressData.code);
	let loading = $derived($addressData.loading);
	let error = $derived($addressData.error);
	let contractInfo = $derived($addressData.contractInfo);
	let contractFunctions = $derived($addressData.contractFunctions);

	let viewFunctions = $derived(
		contractFunctions.filter((f) => isViewFunction(f.stateMutability)),
	);
	let writeFunctions = $derived(
		contractFunctions.filter((f) => !isViewFunction(f.stateMutability)),
	);

	// Bytecode expansion (UI-only)
	let bytecodeExpanded = $state(false);

	// Fetch when address changes
	$effect(() => {
		addressData.fetch(address);
	});
</script>

<DefaultHead title={'Address Explorer'} />

<div class="container mx-auto max-w-5xl px-4 py-8">
	{#if !address}
		<Empty.Root class="min-h-100">
			<Empty.Header>
				<Empty.Media variant="icon">
					<WalletIcon />
				</Empty.Media>
				<Empty.Title>No Address</Empty.Title>
				<Empty.Description>
					Provide an address in the URL to view its details.
					<br />
					Example:
					<code class="rounded bg-muted px-1 text-xs"
						>/explorer/address/0x...</code
					>
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
			<p class="mt-4 text-muted-foreground">Loading address...</p>
		</div>
	{:else if error}
		<Alert.Root variant="destructive">
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{:else}
		<div class="space-y-6">
			<!-- Header -->
			<div class="flex items-center justify-between">
				<div>
					<div class="flex items-center gap-2">
						{#if isContract(code)}
							<div class="rounded-full bg-blue-500/10 p-2">
								<FileCodeIcon class="h-5 w-5 text-blue-500" />
							</div>
							<h1 class="text-2xl font-bold">Smart Contract</h1>
						{:else}
							<div class="rounded-full bg-green-500/10 p-2">
								<WalletIcon class="h-5 w-5 text-green-500" />
							</div>
							<h1 class="text-2xl font-bold">Address</h1>
						{/if}
					</div>
					<div class="mt-2 flex items-center gap-2">
						<Address value={address} linkTo="both" />
					</div>
					{#if contractInfo}
						<div class="mt-1 text-sm text-muted-foreground">
							Contract: {contractInfo.name}
						</div>
					{/if}
				</div>
				<div class="flex gap-2">
					{#if hasBlockExplorer() && address}
						{@const explorerUrl = getBlockExplorerAddressUrl(address)}
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

			<!-- Address Details -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Address Details</Card.Title>
				</Card.Header>
				<Card.Content>
					<div class="grid gap-4 md:grid-cols-3">
						<div>
							<div class="text-sm font-medium text-muted-foreground">
								Balance
							</div>
							<div class="font-mono text-lg">
								{formatEther(balance)}
								{$deployments.chain.nativeCurrency.symbol}
							</div>
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">Nonce</div>
							<div class="font-mono text-lg">{nonce}</div>
						</div>
						<div>
							<div class="text-sm font-medium text-muted-foreground">Type</div>
							<div class="font-mono text-lg">
								{#if isContract(code)}
									Contract ({code.length / 2 - 1} bytes)
								{:else}
									EOA (Externally Owned Account)
								{/if}
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Contract Code -->
			{#if isContract(code)}
				<Card.Root>
					<Card.Header>
						<div class="flex items-center justify-between">
							<Card.Title>Contract Bytecode</Card.Title>
							{#if !bytecodeExpanded && code.length > 400}
								<Button
									onclick={() => (bytecodeExpanded = true)}
									variant="ghost"
									size="sm"
								>
									<ExpandIcon class="mr-2 h-4 w-4" />
									Show Full Code
								</Button>
							{:else if code.length > 400}
								<Button
									onclick={() => (bytecodeExpanded = false)}
									variant="ghost"
									size="sm"
								>
									<ChevronsDownIcon class="mr-2 h-4 w-4" />
									Collapse
								</Button>
							{/if}
						</div>
					</Card.Header>
					<Card.Content>
						<pre
							class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs break-all"><code
								>{bytecodeExpanded ? code : formatBytecode(code)}</code
							></pre>
					</Card.Content>
				</Card.Root>
			{/if}

			<!-- Contract Interaction -->
			{#if contractInfo}
				{#if contractFunctions.length > 0}
					<Tabs value="read">
						<TabsList class="mb-6">
							<TabsTrigger value="read">Read Functions</TabsTrigger>
							<TabsTrigger value="write">Write Functions</TabsTrigger>
						</TabsList>

						<TabsContent value="read">
							{#if viewFunctions.length > 0}
								<div class="space-y-4">
									<h3 class="text-lg font-semibold">View Functions</h3>
									<div class="grid gap-4 md:grid-cols-2">
										{#each viewFunctions as func (func.name)}
											<ContractFunction
												functionName={func.name}
												abiItem={func}
												contractAddress={address}
												{connection}
												{publicClient}
												{accountExecutor}
												{accountCannotSend}
												{balanceCheck}
											/>
										{/each}
									</div>
								</div>
							{:else}
								<Empty.Root>
									<Empty.Header>
										<Empty.Title>No Read Functions</Empty.Title>
										<Empty.Description>
											This contract has no view functions.
										</Empty.Description>
									</Empty.Header>
								</Empty.Root>
							{/if}
						</TabsContent>

						<TabsContent value="write">
							{#if writeFunctions.length > 0}
								<div class="space-y-4">
									<h3 class="text-lg font-semibold">Write Functions</h3>
									<div class="grid gap-4 md:grid-cols-2">
										{#each writeFunctions as func (func.name)}
											<ContractFunction
												functionName={func.name}
												abiItem={func}
												contractAddress={address}
												{connection}
												{publicClient}
												{accountExecutor}
												{accountCannotSend}
												{balanceCheck}
											/>
										{/each}
									</div>
								</div>
							{:else}
								<Empty.Root>
									<Empty.Header>
										<Empty.Title>No Write Functions</Empty.Title>
										<Empty.Description>
											This contract has no write functions.
										</Empty.Description>
									</Empty.Header>
								</Empty.Root>
							{/if}
						</TabsContent>
					</Tabs>
				{:else}
					<Card.Root>
						<Card.Content class="py-8">
							<Empty.Root>
								<Empty.Header>
									<Empty.Media variant="icon">
										<FileCodeIcon />
									</Empty.Media>
									<Empty.Title>No Contract Functions</Empty.Title>
									<Empty.Description>
										This contract is deployed but has no callable functions in
										its ABI.
									</Empty.Description>
								</Empty.Header>
							</Empty.Root>
						</Card.Content>
					</Card.Root>
				{/if}
			{:else if isContract(code)}
				<Alert.Root>
					<FileCodeIcon class="h-4 w-4" />
					<Alert.Description>
						This is a smart contract, but it is not in the deployments file.
						Only the bytecode is available for viewing.
					</Alert.Description>
				</Alert.Root>
			{/if}
		</div>
	{/if}
</div>
