<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import InfoIcon from '@lucide/svelte/icons/info';

	interface Props {
		open: boolean;
		onConfirm: () => void;
		onCancel: () => void;
		status?: 'NotFound' | 'Dropped' | string;
	}

	let {open, onConfirm, onCancel, status = 'NotFound'}: Props = $props();

	let isDropped = $derived(status === 'Dropped');
</script>

<Modal.Root layer="modal" openWhen={open} {onCancel}>
	<Modal.Title>
		<span class="flex items-center gap-2">
			{#if isDropped}
				<InfoIcon class="size-5 text-blue-500" />
			{:else}
				<AlertTriangleIcon class="size-5 text-amber-500" />
			{/if}
			Dismiss Transaction
		</span>
	</Modal.Title>

	<div class="space-y-4 py-4">
		{#if isDropped}
			<p class="text-sm text-muted-foreground">
				This transaction has been dropped by the network and will not be
				processed. It is safe to remove it from your view.
			</p>
			<p class="text-sm font-medium">
				Would you like to dismiss this transaction?
			</p>
		{:else}
			<p class="text-sm text-muted-foreground">
				This transaction may still be processed by the network. Dismissing it
				only removes it from your view.
			</p>
			<p class="text-sm font-medium text-destructive">
				Are you sure you want to dismiss this transaction? This action cannot be
				undone.
			</p>
		{/if}
	</div>

	<Modal.Footer>
		<Button variant="outline" onclick={onCancel}>Cancel</Button>
		<Button variant={isDropped ? 'default' : 'destructive'} onclick={onConfirm}>
			Dismiss
		</Button>
	</Modal.Footer>
</Modal.Root>
