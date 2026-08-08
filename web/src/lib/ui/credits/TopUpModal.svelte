<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import {hasFaucet} from '$lib/core/ui/faucet/index.js';
	import {getAppContext} from '$lib';
	import {deployments} from '$lib/deployments-store';
	import {topUpActionLabel} from './credits-view';

	// Every decision below (which step, how much, what it buys) is made in
	// ./top-up-flow.ts, which the context holds one of. This renders the answer.
	const {topUp, errorDetails, credits} = getAppContext();
</script>

<Modal.Root openWhen={$topUp.open} onCancel={() => topUp.cancel()}>
	<Modal.Title>
		<span class="flex items-center gap-2">
			<CoinsIcon class="h-5 w-5" />
			{topUpActionLabel(credits)}
		</span>
	</Modal.Title>

	<div class="space-y-4 py-4">
		{#if $topUp.phase === 'connecting'}
			<p class="flex items-center gap-2 text-muted-foreground">
				<Spinner class="h-4 w-4" />
				Choose the account to pay from.
			</p>
		{:else if $topUp.phase === 'claiming'}
			<p class="flex items-center gap-2 text-muted-foreground">
				<Spinner class="h-4 w-4" />
				Waiting for the funds to arrive.
			</p>
		{:else if $topUp.phase === 'failed'}
			<p class="text-muted-foreground">
				Nothing was charged. You can close this and try again.
			</p>
		{:else if $topUp.phase === 'empty'}
			<p class="text-muted-foreground">
				The account you chose to pay from is empty, so there is nothing to
				transfer yet.
			</p>
			{#if $topUp.payer}
				<div class="rounded-lg bg-muted p-4">
					<span class="text-sm text-muted-foreground">Paying account</span>
					<Address value={$topUp.payer} size="xs" mono />
				</div>
			{/if}
			{#if !hasFaucet}
				<p class="text-sm text-muted-foreground">
					No faucet is configured, so this account has to be funded elsewhere
					before you can continue.
				</p>
			{/if}
		{:else}
			<p class="text-muted-foreground">
				{#if credits}
					This adds credits to your in-app balance, so the app can keep making
					moves for you.
				{:else}
					This moves funds to your in-app balance, so the app can keep making
					moves for you.
				{/if}
			</p>

			<div class="space-y-2 rounded-lg bg-muted p-4">
				{#if $topUp.creditsText}
					<div class="flex justify-between">
						<span class="text-muted-foreground">You get:</span>
						<span class="font-mono">{$topUp.creditsText} credits</span>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Cost:</span>
					<span class="font-mono">
						{$topUp.valueText}
						{$deployments.chain.nativeCurrency.symbol}
					</span>
				</div>
				{#if $topUp.payer}
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Paid by:</span>
						<Address value={$topUp.payer} size="xs" mono />
					</div>
				{/if}
			</div>
		{/if}

		{#if $topUp.error}
			<p class="flex items-start gap-2 text-sm text-destructive">
				<AlertTriangleIcon class="mt-0.5 h-4 w-4 shrink-0" />
				<span>{$topUp.error}</span>
				{#if $topUp.details}
					<button
						class="underline"
						onclick={() => errorDetails.show($topUp.details ?? '')}
					>
						Details
					</button>
				{/if}
			</p>
		{/if}
	</div>

	<Modal.Footer>
		<!-- EVERY phase offers a way out. A footer that renders nothing leaves a
		     modal with only its close cross, which is what the connecting step did
		     when a wallet failed to connect: a spinner, an error, and no way to
		     retry. -->
		{#if $topUp.phase === 'connecting' || $topUp.phase === 'claiming'}
			{#if $topUp.error}
				<Button
					class="flex-1"
					onclick={() => topUp.start()}
					disabled={$topUp.busy}
				>
					Try again
				</Button>
			{/if}
			<Button variant="outline" onclick={() => topUp.cancel()}>Cancel</Button>
		{:else if $topUp.phase === 'empty'}
			{#if $topUp.claimed}
				<!-- The claim already returned, and it returns once its transaction is
				     in. So this re-READS rather than claiming again: claiming twice
				     would ask the faucet for money it has already sent. -->
				<Button
					class="flex-1"
					onclick={() => topUp.refresh()}
					disabled={$topUp.busy}
				>
					Continue
				</Button>
			{:else if hasFaucet}
				<Button
					class="flex-1"
					onclick={() => topUp.claim()}
					disabled={$topUp.busy}
				>
					Get funds from the faucet
				</Button>
			{/if}
			<Button variant="outline" onclick={() => topUp.cancel()}>Cancel</Button>
		{:else if $topUp.phase === 'failed'}
			<Button variant="outline" class="w-full" onclick={() => topUp.cancel()}>
				Close
			</Button>
		{:else if $topUp.phase === 'ready' || $topUp.phase === 'sending'}
			<Button
				class="flex-1"
				onclick={() => topUp.confirm()}
				disabled={$topUp.busy}
			>
				{#if $topUp.busy}<Spinner class="h-4 w-4" />{/if}
				Continue
			</Button>
			<Button
				variant="outline"
				onclick={() => topUp.cancel()}
				disabled={$topUp.busy}
			>
				Cancel
			</Button>
		{/if}
	</Modal.Footer>
</Modal.Root>
