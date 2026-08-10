<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import {getAppContext} from '$lib';

	// Renders whatever question is pending, and knows nothing about who asked it
	// or what it is about. Every word comes from the request; see
	// ./confirmation.ts for who supplies what.
	const {confirmation} = getAppContext();
</script>

<Modal.Root
	openWhen={$confirmation.step === 'asking'}
	onCancel={() => $confirmation.step === 'asking' && $confirmation.onCancel()}
>
	{#if $confirmation.step === 'asking'}
		<Modal.Title>
			<span
				class="flex items-center gap-2 {$confirmation.destructive
					? 'text-destructive'
					: 'text-green-600'}"
			>
				{#if $confirmation.destructive}
					<TriangleAlertIcon class="h-5 w-5" />
				{:else}
					<CircleCheckIcon class="h-5 w-5" />
				{/if}
				{$confirmation.title}
			</span>
		</Modal.Title>
		<Modal.Description>{$confirmation.explanation}</Modal.Description>

		{#if $confirmation.detail}
			<!-- Shown, not described: when the question is whether to carry on with
			     something, the point is that it is still the thing they asked for. -->
			<p
				class="my-4 rounded-lg border-l-2 border-primary bg-muted px-4 py-3 wrap-break-word"
				data-testid="confirmation-detail"
			>
				{$confirmation.detail}
			</p>
		{/if}

		<Modal.Footer>
			<Button
				variant="outline"
				onclick={() =>
					$confirmation.step === 'asking' && $confirmation.onCancel()}
				data-testid="confirmation-cancel"
			>
				{$confirmation.cancelLabel ?? 'Not now'}
			</Button>
			<Button
				variant={$confirmation.destructive ? 'destructive' : 'default'}
				onclick={() =>
					$confirmation.step === 'asking' && $confirmation.onConfirm()}
				data-testid="confirmation-confirm"
			>
				{$confirmation.confirmLabel}
			</Button>
		</Modal.Footer>
	{/if}
</Modal.Root>
