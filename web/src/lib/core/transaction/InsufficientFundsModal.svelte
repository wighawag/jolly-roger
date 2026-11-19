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
	import {payerAddressOf} from '$lib/core/connection/remote';

	const {balanceCheck, accountExecutor, signerExecutor, payment, topUp} =
		getAppContext();
	const paymentConnection = payment.connection;

	let isOpen = $derived($balanceCheck.step !== 'idle');

	// Subscribe to the nested balance store (only present in the insufficient step).
	let balanceStoreRef = $derived.by(() =>
		$balanceCheck.step === 'insufficient' ? $balanceCheck.balanceStore : null,
	);
	let currentBalance = $derived(balanceStoreRef ? $balanceStoreRef : null);

	// EVERY ACCOUNT THIS APP CAN SEND FROM, which on this branch is three.
	//
	// The view classifies the sender against this list rather than comparing it
	// with one address, and the difference is the bug this replaces: a wallet on
	// the payment rail is neither the account nor the signer, so under
	// `accountAddress === sender` it fell into the signer's branch. An empty
	// MetaMask account the user had just chosen to pay with was then called "your
	// in-app spending account" and offered a top-up that funds the signer, so the
	// money went somewhere nobody was waiting on and the transaction failed for
	// exactly the reason it already had.
	//
	// A payer that is not listed here is classified `unknown` and offered
	// nothing, which is the safe direction: naming the wrong account is worse
	// than declining to name one.
	let payers = $derived([
		{
			kind: 'account' as const,
			address:
				$accountExecutor.status === 'ready'
					? $accountExecutor.address
					: undefined,
		},
		{
			kind: 'signer' as const,
			address:
				$signerExecutor.status === 'ready'
					? $signerExecutor.address
					: undefined,
		},
		{
			// Undefined while the rail is dormant, which is most of the time. That
			// is an absence rather than a wildcard: it simply never matches.
			kind: 'rail' as const,
			address: payerAddressOf($paymentConnection),
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
			     anyway. That is not a rule this markup has to remember: `remedy` is one
			     field, so there is no order to test these in and no way to show two. -->
			{#if !hasSufficientFunds && !isWaitingForBalanceUpdate}
				{#if view.remedy.kind === 'faucet'}
					<!-- Carries the address to fund, which is the account that is short:
					     the authenticated account, or the wallet on the payment rail that
					     the user picked. The faucet always took a target; only the
					     two-payer assumption above kept it aimed at whoever was signed
					     in. -->
					<FaucetButton target={view.remedy.target} />
				{:else if view.remedy.kind === 'top-up'}
					<!-- The account that is short is the in-app signer, which the faucet
					     deliberately will not fund. Topping up can, and it reports back to
					     this store when it succeeds, so the footer below switches to
					     "Continue Transaction" and the blocked transaction carries on.

					     Opens OVER this modal rather than replacing it: this one is still
					     the thing being resolved. That takes the top-up modal being in the
					     same layer as this one - it is `layer="system"`, and for a long
					     time the top-up modal was not, so it opened underneath and this
					     comment was simply untrue. Declaration order in AcrossPages ranks
					     them once they share a layer; it cannot reach across two. -->
					<!-- The purpose is funding the signer, even though the reason the
					     user is here is a blocked transaction: what they are about to PAY
					     for is the in-app balance, and this dialog has already explained
					     the blockage. -->
					<Button
						class="w-full"
						onclick={() => topUp.start(topUp.purposes.topUp)}
					>
						Top up the in-app balance
					</Button>
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
