<script lang="ts">
	import {toast} from 'svelte-sonner';
	import {getAppContext} from '$lib';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {Input} from '$lib/shadcn/ui/input/index.js';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import {getCredits, resolveTopUpAmount} from './get-credits';
	import type {CreditsView} from './credits-view';

	let {view}: {view: CreditsView} = $props();

	const context = getAppContext();
	const {credits, deployments, errorDetails} = context;

	// UI-only state: what the user typed, and whether a purchase is in flight.
	let amountInput = $state('');
	let busy = $state(false);

	// The amount rule (fixed price per top-up vs. a typed figure) lives in
	// ./get-credits.ts; this only reflects its verdict.
	let amount = $derived(
		resolveTopUpAmount(
			credits,
			amountInput,
			$deployments.chain.nativeCurrency.decimals,
		),
	);

	async function topUp() {
		if (busy || !amount.ok || !view.signerAddress) return;
		busy = true;
		try {
			const result = await getCredits(context, {
				to: view.signerAddress,
				value: amount.value,
			});
			if (result.status === 'bought') {
				amountInput = '';
			} else if (result.status === 'error') {
				toast.error('Could not add funds', {
					description: result.message,
					duration: 8000,
					closeButton: true,
					action: {
						label: 'Details',
						onClick: () => errorDetails.show(result.details),
					},
				});
			}
		} finally {
			busy = false;
		}
	}
</script>

{#if view.visible}
	<div
		class="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2"
		data-testid="credits-panel"
	>
		<div class="flex items-center justify-between">
			<span class="text-sm text-muted-foreground">{view.label}</span>
			{#if !view.showSignerBalance}
				<!-- Shown above as the spending balance; see credits-view.ts. -->
			{:else if view.signerText !== null}
				<span
					class="font-medium {view.needsFunding ? 'text-amber-500' : ''}"
					data-testid="credits-balance">{view.signerText}</span
				>
			{:else}
				<Spinner class="h-4 w-4" />
			{/if}
		</div>

		{#if view.signerAddress}
			<Address value={view.signerAddress} size="xs" mono />
		{/if}

		{#if view.showOwnerBalance}
			<div class="flex items-center justify-between">
				<span class="text-sm text-muted-foreground">Your account</span>
				{#if view.ownerText !== null}
					<span class="font-medium">{view.ownerText}</span>
				{:else}
					<Spinner class="h-4 w-4" />
				{/if}
			</div>
		{/if}

		<p class="text-xs text-muted-foreground">{view.description}</p>

		{#if view.needsFunding}
			<p class="flex items-start gap-1 text-xs text-amber-500">
				<AlertCircleIcon class="mt-0.5 h-3 w-3 shrink-0" />
				<span>
					{view.denominatedInCredits
						? 'You have no credits, so the app cannot make a move for you.'
						: 'This account is empty, so the app cannot make a move for you.'}
				</span>
			</p>
		{/if}

		{#if view.topUpNeedsAmount}
			<div class="flex items-center gap-2">
				<Input
					type="text"
					inputmode="decimal"
					placeholder="0.01"
					bind:value={amountInput}
					disabled={busy}
					aria-label="Amount to add"
					class="h-8 flex-1"
				/>
				<Button size="sm" onclick={topUp} disabled={busy || !amount.ok}>
					{#if busy}<Spinner class="h-4 w-4" />{/if}
					{view.topUpLabel}
				</Button>
			</div>
			{#if amountInput.trim() && !amount.ok}
				<span class="text-xs text-destructive">{amount.error}</span>
			{/if}
		{:else}
			<Button size="sm" class="w-full" onclick={topUp} disabled={busy}>
				{#if busy}<Spinner class="h-4 w-4" />{/if}
				{view.topUpLabel}
			</Button>
		{/if}
	</div>
{/if}
