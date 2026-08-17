<script lang="ts">
	import type {AbiFunction, PublicClient} from 'viem';
	import * as Card from '$lib/shadcn/ui/card';
	import {Button} from '$lib/shadcn/ui/button';
	import FunctionInputs from './FunctionInputs.svelte';
	import {
		formatFunctionSignature,
		isViewFunction,
		formatOutputJSON,
	} from '../lib/utils';
	import {readContractValue, executeContractWrite} from '../lib/contractCall';
	import {txErrorSummary} from '$lib/core/transaction/tx-error-summary';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import * as Alert from '$lib/shadcn/ui/alert';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import InfoIcon from '@lucide/svelte/icons/info';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import type {
		AnyConnectionStore,
		UnderlyingEthereumProvider,
	} from '@etherplay/connect';
	import {route} from '$lib';
	import type {ExecutorStore} from '$lib/core/connection/executor';
	import type {BalanceStore} from '$lib/core/connection/balance';
	import type {AccountCannotSendStore} from '$lib/core/transaction/account-cannot-send-store';
	import TransactionHash from '$lib/core/ui/ethereum/TransactionHash.svelte';
	import type {BalanceCheckStore} from '$lib/core/transaction/balance-check-store';

	interface Props {
		functionName: string;
		abiItem: AbiFunction;
		contractAddress: string;
		connection: AnyConnectionStore<UnderlyingEthereumProvider>;
		publicClient: PublicClient;
		accountExecutor: ExecutorStore;
		accountBalance: BalanceStore;
		accountCannotSend: AccountCannotSendStore;
		balanceCheck: BalanceCheckStore;
	}

	let {
		functionName,
		abiItem,
		contractAddress,
		connection,
		publicClient,
		accountExecutor,
		accountBalance,
		accountCannotSend,
		balanceCheck,
	}: Props = $props();

	let inputValues = $state<Record<string, string>>({});
	let inputErrors = $state<Record<string, string>>({});
	let loading = $state(false);
	let result = $state<any>(null);
	let transactionHash = $state<`0x${string}` | null>(null);
	let error = $state<string | null>(null);

	let isView = $derived(isViewFunction(abiItem.stateMutability));

	async function handleFetch() {
		loading = true;
		error = null;
		result = null;
		transactionHash = null;

		try {
			result = await readContractValue({
				publicClient,
				abiItem,
				contractAddress,
				inputValues,
			});
		} catch (e: any) {
			error = e.message || 'Failed to fetch value';
			console.error('Error fetching value:', e);
		} finally {
			loading = false;
		}
	}

	async function handleExecute() {
		// Check for validation errors
		const hasErrors = Object.keys(inputErrors).some(
			(key) => inputErrors[key] !== undefined,
		);
		if (hasErrors) {
			error = 'Please fix input errors before executing';
			return;
		}

		loading = true;
		error = null;
		result = null;
		transactionHash = null;

		try {
			const outcome = await executeContractWrite({
				connection,
				accountExecutor,
				accountBalance,
				balanceCheck,
				abiItem,
				contractAddress,
				inputValues,
			});
			if (outcome.status === 'submitted') {
				transactionHash = outcome.transactionHash;
				result = null;
				error = null;
			} else if (outcome.status === 'cannot-send') {
				accountCannotSend.show();
			}
		} catch (e: any) {
			// Summarised rather than shown raw: `e.message` on a viem error is the
			// whole multi-line dump, and for an account that cannot pay it is the
			// node's own prose (or viem's misleading category for it).
			error = txErrorSummary(e);
			console.error('Error executing transaction:', e);
		} finally {
			loading = false;
		}
	}

	function clearResults() {
		result = null;
		transactionHash = null;
		error = null;
	}
</script>

<Card.Root class="border-2">
	<Card.Header>
		<div class="flex items-start justify-between gap-2">
			<div class="flex-1 space-y-1">
				<Card.Title class="font-mono text-base">
					{functionName}
					<span
						class="ml-2 rounded-full px-2 py-0.5 text-xs font-medium"
						class:bg-muted-foreground={isView}
						class:text-background={isView}
						class:bg-primary={!isView}
						class:text-primary-foreground={!isView}
					>
						{abiItem.stateMutability}
					</span>
				</Card.Title>
				<Card.Description class="font-mono text-xs">
					{formatFunctionSignature(abiItem)}
				</Card.Description>
			</div>
		</div>
	</Card.Header>

	<Card.Content class="space-y-4">
		{#if abiItem.inputs.length > 0}
			<div class="space-y-2">
				<div class="text-sm font-medium">Arguments</div>
				<FunctionInputs
					inputs={abiItem.inputs}
					values={inputValues}
					errors={inputErrors}
				/>
			</div>
		{/if}

		{#if error}
			<Alert.Root variant="destructive" class="max-w-full overflow-hidden">
				<CircleAlertIcon class="h-4 w-4 shrink-0" />
				<Alert.Description
					class="overflow-wrap-break-word max-h-32 min-w-0 overflow-y-auto text-sm wrap-break-word"
					>{error}</Alert.Description
				>
			</Alert.Root>
		{/if}

		{#if result !== null}
			<div class="space-y-2">
				<div
					class="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400"
				>
					<CircleCheckIcon class="h-4 w-4" />
					<span>Result</span>
				</div>
				<pre
					class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"><code
						>{formatOutputJSON(result)}</code
					></pre>
			</div>
		{/if}

		{#if transactionHash}
			<Alert.Root>
				<InfoIcon class="h-4 w-4" />
				<Alert.Description class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Transaction submitted</span>
					<a
						href={route(`/explorer/tx/${transactionHash}`)}
						class="text-primary hover:underline"
					>
						<TransactionHash value={transactionHash} linkTo="auto" />
					</a>
				</Alert.Description>
			</Alert.Root>
		{/if}
	</Card.Content>

	<Card.Footer class="flex gap-2">
		{#if isView}
			<Button
				onclick={handleFetch}
				disabled={loading}
				class="flex-1"
				variant={result ? 'outline' : 'default'}
			>
				{#if loading}
					<Spinner />
					Fetching...
				{:else}
					Fetch Value
				{/if}
			</Button>
		{:else}
			<!-- disabled={loading || !walletClient || !account}-->
			<Button
				onclick={handleExecute}
				class="flex-1"
				variant={transactionHash ? 'outline' : 'default'}
			>
				{#if loading}
					<Spinner />
					Executing...
				{:else if $connection.step != 'SignedIn' && $connection.step != 'WalletConnected'}
					Connect + Execute
				{:else}
					Execute
				{/if}
			</Button>
		{/if}

		{#if result !== null || transactionHash !== null}
			<Button onclick={clearResults} variant="ghost" disabled={loading}>
				Clear
			</Button>
		{/if}
	</Card.Footer>
</Card.Root>
