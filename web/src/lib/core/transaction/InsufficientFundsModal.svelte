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

	const {balanceCheck, accountExecutor} = getAppContext();

	let isOpen = $derived($balanceCheck.step !== 'idle');

	// Subscribe to the nested balance store (only present in the insufficient step).
	let balanceStoreRef = $derived.by(() =>
		$balanceCheck.step === 'insufficient' ? $balanceCheck.balanceStore : null,
	);
	let currentBalance = $derived(balanceStoreRef ? $balanceStoreRef : null);

	// EVERY ACCOUNT THIS APP CAN SEND FROM. One, here: this branch has no local
	// signer and no payment rail, so a transaction is only ever sent by the
	// account the user signed in as. A descendant that adds a payer adds an entry,
	// and the view then names it and picks its remedy - which is the whole reason
	// this is a list rather than an address compared against the sender.
	let payers = $derived([
		{
			kind: 'account' as const,
			address:
				$accountExecutor.status === 'ready'
					? $accountExecutor.address
					: undefined,
		},
	]);

	// All balance math, all wording about WHO is short, and the choice of remedy
	// live in the pure view-model helper.
	let view = $derived(
		deriveInsufficientFundsView($balanceCheck, currentBalance, {
			payers,
			faucetConfigured: hasFaucet,
		}),
	);
	let hasSufficientFunds = $derived(view.hasSufficientFunds);
	let displayBalance = $derived(view.displayBalance);
	let isWaitingForBalanceUpdate = $derived(view.isWaitingForBalanceUpdate);
	let shortfall = $derived(view.shortfall);
</script>

<Modal.Root
	layer="system"
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
				<p class="text-muted-foreground">{view.payer.explanation}</p>
				{#if view.payer.showAddress && view.payer.address}
					<p class="font-mono text-sm break-all text-muted-foreground">
						{view.payer.address}
					</p>
				{/if}
			{/if}

			<div class="space-y-2 rounded-lg bg-muted p-4">
				<div class="flex justify-between">
					<span class="text-muted-foreground">{view.payer.balanceLabel}</span>
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

			<!-- AT MOST ONE REMEDY, and it is chosen in the view rather than here.
			     Offering the wrong one is worse than offering nothing: it appears to
			     work, moves a balance nobody was waiting on, and the transaction fails
			     anyway. The faucet carries the address it should fund, so this cannot
			     aim it at whoever happens to be signed in. -->
			{#if !hasSufficientFunds && !isWaitingForBalanceUpdate}
				{#if view.remedy.kind === 'faucet'}
					<FaucetButton target={view.remedy.target} />
				{/if}
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
