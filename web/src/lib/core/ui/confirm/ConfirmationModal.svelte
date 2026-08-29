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

	// The question is a prompt overlay, and an overlay nobody renders is a silent
	// no-op: here that would be an `ask()` that never settles, with no dialog to
	// say why. Declaring this is what makes the registry warn instead.
	$effect(() => confirmation.registerRenderer());
</script>

<!-- SYSTEM, and for the same reason as the top-up modal it is declared after in
     AcrossPages: this asks ABOUT a flow already in progress (carry on with what
     was interrupted, or really give up on a request the wallet may still act
     on), so it must be able to cover whatever raised it. It had the same hole -
     no layer named, so the default put it a rank below every modal it exists to
     sit on top of, and its position in AcrossPages bought it nothing. -->
<Modal.Root
	layer="system"
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
