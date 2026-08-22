<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/core/ui/button';
	import {Spinner} from '$ui/spinner/index.js';
	import {formatBalance} from '$lib/core/utils/format/balance';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import {FaucetButton, hasFaucet} from '$lib/core/ui/faucet/index.js';
	import {deployments} from '$lib/deployments-store';
	import {getAppContext} from '$lib';
	import {deriveInsufficientFundsView} from './insufficient-funds-view';

	const {balanceCheck} = getAppContext();

	let isOpen = $derived($balanceCheck.step !== 'idle');

	// Subscribe to the nested balance store (only present in the insufficient step).
	let balanceStoreRef = $derived.by(() =>
		$balanceCheck.step === 'insufficient' ? $balanceCheck.balanceStore : null,
	);
	let currentBalance = $derived(balanceStoreRef ? $balanceStoreRef : null);

	// All balance math lives in the pure view-model helper.
	let view = $derived(
		deriveInsufficientFundsView($balanceCheck, currentBalance),
	);
	let hasSufficientFunds = $derived(view.hasSufficientFunds);
	let displayBalance = $derived(view.displayBalance);
	let isWaitingForBalanceUpdate = $derived(view.isWaitingForBalanceUpdate);
	let shortfall = $derived(view.shortfall);
</script>

<Modal.Root
	openWhen={isOpen}
	onCancel={() =>
		$balanceCheck.step === 'insufficient' && $balanceCheck.onDismiss?.()}
>
	{#if $balanceCheck.step === 'estimating'}
		<Modal.Title>Preparing Transaction</Modal.Title>
		<div class="flex flex-col items-center gap-4 py-8">
			<Spinner class="h-10 w-10" />
			<p class="text-muted-foreground">Estimating transaction cost...</p>
		</div>
	{:else if $balanceCheck.step === 'insufficient'}
		<Modal.Title>
			{#if hasSufficientFunds}
				<span class="flex items-center gap-2 text-green-600">
					<CircleCheckIcon class="h-5 w-5" />
					Funds Available
				</span>
			{:else}
				<span class="flex items-center gap-2 text-destructive">
					<AlertTriangleIcon class="h-5 w-5" />
					Insufficient Funds
				</span>
			{/if}
		</Modal.Title>

		<div class="space-y-4 py-4">
			{#if hasSufficientFunds}
				<p class="text-muted-foreground">
					You now have enough funds to complete this transaction.
				</p>
			{:else if $balanceCheck.isWaitingForBalanceUpdate}
				<p class="flex items-center gap-2 text-muted-foreground">
					<Spinner class="h-4 w-4" />
					Waiting for balance update...
				</p>
			{:else}
				<p class="text-muted-foreground">
					You don't have enough funds to complete this transaction.
				</p>
			{/if}

			<div class="space-y-2 rounded-lg bg-muted p-4">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Your balance:</span>
					<span class="font-mono"
						>{formatBalance(displayBalance)}
						{$deployments.chain.nativeCurrency.symbol}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Estimated cost:</span>
					<span class="font-mono"
						>{formatBalance($balanceCheck.estimatedCost)}
						{$deployments.chain.nativeCurrency.symbol}</span
					>
				</div>
				{#if !hasSufficientFunds}
					<hr class="border-border" />
					<div class="flex justify-between text-destructive">
						<span>Shortfall:</span>
						<span class="font-mono"
							>{formatBalance(shortfall)}
							{$deployments.chain.nativeCurrency.symbol}</span
						>
					</div>
				{/if}
			</div>

			{#if !hasSufficientFunds && !isWaitingForBalanceUpdate && hasFaucet}
				<FaucetButton />
			{/if}
		</div>

		<Modal.Footer>
			<!-- isWaitingForBalanceUpdate allow optimistic continuation of the tx assuming the faucet will give enough -->
			{#if hasSufficientFunds || isWaitingForBalanceUpdate}
				<Button onclick={$balanceCheck.onContinue} class="w-full">
					Continue Transaction
				</Button>
			{:else}
				<Button variant="outline" onclick={$balanceCheck.onDismiss}
					>Dismiss</Button
				>
			{/if}
		</Modal.Footer>
	{/if}
</Modal.Root>
