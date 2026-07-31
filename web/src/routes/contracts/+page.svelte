<script lang="ts">
	import DefaultHead from '$lib/metadata/DefaultHead.svelte';
	import {getAppContext} from '$lib';
	import {
		Root as Tabs,
		Content as TabsContent,
		List as TabsList,
		Trigger as TabsTrigger,
	} from '$lib/shadcn/ui/tabs';
	import * as Select from '$lib/shadcn/ui/select';
	import * as Empty from '$lib/shadcn/ui/empty';
	import * as Separator from '$lib/shadcn/ui/separator';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import ContractFunction from './components/ContractFunction.svelte';
	import {
		getContractFunctions,
		getFunctionSignature,
		isViewFunction,
	} from './lib/utils';
	import Address from '$lib/core/ui/ethereum/Address.svelte';

	let {
		publicClient,
		executor,
		accountCannotSend,
		connection,
		deployments,
		balance,
		gasFee,
		balanceCheck,
	} = getAppContext();

	// Get all contract names
	let contractNames = $derived(Object.keys($deployments.contracts));

	// Get all functions for each contract
	let contractFunctions = $derived(
		contractNames.map((name) => ({
			name,
			address:
				$deployments.contracts[name as keyof typeof $deployments.contracts]
					.address,
			abi: $deployments.contracts[name as keyof typeof $deployments.contracts]
				.abi,
			functions: getContractFunctions(
				$deployments.contracts[name as keyof typeof $deployments.contracts].abi,
			),
		})),
	);

	// Split functions into view and write
	let contractFunctionGroups = $derived(
		contractFunctions.map((contract) => ({
			...contract,
			viewFunctions: contract.functions.filter((f) =>
				isViewFunction(f.stateMutability),
			),
			writeFunctions: contract.functions.filter(
				(f) => !isViewFunction(f.stateMutability),
			),
		})),
	);

	// Selected contract state - initialize with first contract name
	let selectedContractName = $state<string>('');

	// Set initial selection when contracts are loaded
	$effect(() => {
		if (contractNames.length > 0 && selectedContractName === '') {
			selectedContractName = contractNames[0];
		}
	});

	// Get the currently selected contract
	let selectedContract = $derived(
		contractFunctionGroups.find((c) => c.name === selectedContractName),
	);

	function handleContractChange(value: string | undefined) {
		if (value) {
			selectedContractName = value;
		}
	}
</script>

<DefaultHead title={'Contracts'} />

<div class="container mx-auto max-w-5xl px-4 py-8">
	{#if contractNames.length === 0}
		<Empty.Root class="min-h-100">
			<Empty.Header>
				<Empty.Media variant="icon">
					<FileCodeIcon />
				</Empty.Media>
				<Empty.Title>No Contracts Found</Empty.Title>
				<Empty.Description>
					There are no deployed contracts available on this network.
				</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else}
		<div class="space-y-6">
			<div class="flex flex-col items-center space-y-2">
				<div class="rounded-full bg-primary/10 p-3">
					<FileCodeIcon class="h-8 w-8 text-primary" />
				</div>
				<h1 class="text-3xl font-bold">Contracts</h1>
				<p class="text-muted-foreground">
					Interact with deployed smart contracts
				</p>
			</div>

			<Separator.Root />

			<!-- Contract Selection -->
			<Select.Root
				type="single"
				bind:value={selectedContractName}
				onValueChange={handleContractChange}
			>
				<Select.Trigger class="w-full">
					{selectedContractName || 'Select a contract'}
				</Select.Trigger>
				<Select.Content>
					{#each contractFunctionGroups as contract (contract.name)}
						<Select.Item value={contract.name}>{contract.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>

			<!-- Selected Contract Content -->
			{#if selectedContract}
				<div class="space-y-6">
					<div class="rounded-lg bg-muted/50 p-4">
						<h2 class="text-xl font-semibold">{selectedContract.name}</h2>

						<Address value={selectedContract.address} linkTo="auto" />
					</div>

					{#if selectedContract.viewFunctions.length === 0 && selectedContract.writeFunctions.length === 0}
						<Empty.Root>
							<Empty.Header>
								<Empty.Title>No Functions Found</Empty.Title>
								<Empty.Description>
									This contract has no callable functions.
								</Empty.Description>
							</Empty.Header>
						</Empty.Root>
					{:else}
						<Tabs value="read">
							<TabsList class="mb-6">
								<TabsTrigger value="read">Read</TabsTrigger>
								<TabsTrigger value="write">Write</TabsTrigger>
							</TabsList>

							<TabsContent value="read">
								{#if selectedContract.viewFunctions.length > 0}
									<div class="space-y-4">
										<h3 class="text-lg font-semibold">View Functions</h3>
										<div class="grid gap-4 md:grid-cols-2">
											<!-- Keyed by full signature, not name: overloads (ERC721 has two
											     safeTransferFrom) share a name and would collide. -->
											{#each selectedContract.viewFunctions as func (getFunctionSignature(func))}
												<ContractFunction
													functionName={func.name}
													abiItem={func}
													contractAddress={selectedContract.address}
													{connection}
													{publicClient}
													{executor}
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
								{#if selectedContract.writeFunctions.length > 0}
									<div class="space-y-4">
										<h3 class="text-lg font-semibold">Write Functions</h3>
										<div class="grid gap-4 md:grid-cols-2">
											{#each selectedContract.writeFunctions as func (getFunctionSignature(func))}
												<ContractFunction
													functionName={func.name}
													abiItem={func}
													contractAddress={selectedContract.address}
													{connection}
													{publicClient}
													{executor}
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
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
