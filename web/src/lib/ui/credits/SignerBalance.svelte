<script lang="ts">
	import {getAppContext} from '$lib';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import type {CreditsView} from './credits-view';

	let {view}: {view: CreditsView} = $props();

	// The flow itself is a modal (TopUpModal, rendered in AcrossPages), so this
	// row only has to open it. Same instance the insufficient-funds modal uses.
	const {topUp} = getAppContext();
</script>

{#if view.visible}
	<div
		class="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2"
		data-testid="signer-balance"
	>
		<div class="flex items-center justify-between">
			<span class="text-sm text-muted-foreground" title={view.description}>
				{view.label}
			</span>
			{#if view.signerText !== null}
				<span
					class="font-medium {view.needsFunding ? 'text-amber-500' : ''}"
					data-testid="credits-balance">{view.signerText}</span
				>
			{:else}
				<Spinner class="h-4 w-4" />
			{/if}
		</div>

		<!-- Kept visible: this is the account to send funds to by hand when the
		     in-app flow cannot help. -->
		{#if view.signerAddress}
			<Address value={view.signerAddress} size="xs" mono />
		{/if}

		{#if view.needsFunding}
			<p class="flex items-start gap-1 text-xs text-amber-500">
				<AlertCircleIcon class="mt-0.5 h-3 w-3 shrink-0" />
				<span>
					{view.denominatedInCredits
						? 'You have no credits, so the app cannot make a move for you.'
						: 'This is empty, so the app cannot make a move for you.'}
				</span>
			</p>
		{/if}

		<Button size="sm" class="w-full" onclick={() => topUp.start()}>
			{view.topUpLabel}
		</Button>
	</div>
{/if}
