<script lang="ts">
	import {getAppContext} from '$lib';
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';

	const {deployments} = getAppContext();

	interface Props {
		open: boolean;
		onConfirm: () => void;
		onCancel: () => void;
		isSubmitting?: boolean;
		errorMessage?: string | null;
	}

	let {
		open,
		onConfirm,
		onCancel,
		isSubmitting = false,
		errorMessage = null,
	}: Props = $props();
</script>

<Modal.Root layer="modal" openWhen={open} {onCancel}>
	<Modal.Title>
		<span class="flex items-center gap-2">
			<XCircleIcon class="size-5 text-destructive" />
			Cancel Transaction
		</span>
	</Modal.Title>

	<div class="space-y-4 py-4">
		<p class="text-sm text-muted-foreground">
			This will send a 0 {$deployments.chain.nativeCurrency.symbol} transaction to
			yourself with the same nonce but higher gas price.
		</p>
		<p class="text-sm text-muted-foreground">
			If successful, the original transaction will be replaced and effectively
			canceled.
		</p>
		<div
			class="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
		>
			<strong>Note:</strong> This will cost a small amount of gas. The cancellation
			is not guaranteed if the original transaction is already being processed.
		</div>

		{#if errorMessage}
			<div
				class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
			>
				{errorMessage}
			</div>
		{/if}
	</div>

	<Modal.Footer>
		<Button variant="outline" onclick={onCancel} disabled={isSubmitting}>
			Go Back
		</Button>
		<Button variant="destructive" onclick={onConfirm} disabled={isSubmitting}>
			{#if isSubmitting}
				Canceling...
			{:else}
				Cancel Transaction
			{/if}
		</Button>
	</Modal.Footer>
</Modal.Root>
