<script lang="ts">
	// A message box: renders a composer ($lib/messaging/panel) and submits to it.
	// The text is this box's own; sending and its failure are the composer's.
	import {Button} from '$lib/shadcn/ui/button';
	import {Input} from '$lib/shadcn/ui/input';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import SendIcon from '@lucide/svelte/icons/send';
	import type {Composer} from '$lib/messaging/panel';

	let {
		composer,
		placeholder,
		label = 'Send',
		testid,
	}: {
		composer: Composer;
		placeholder: string;
		label?: string;
		testid: string;
	} = $props();

	let text = $state('');
</script>

<form
	class="flex gap-2"
	data-testid={testid}
	onsubmit={async (e) => {
		e.preventDefault();
		if (await composer.submit(text)) text = '';
	}}
>
	<Input
		type="text"
		{placeholder}
		bind:value={text}
		disabled={$composer.sending}
		class="flex-1"
	/>
	<Button type="submit" size="sm" disabled={$composer.sending || !text.trim()}>
		{#if $composer.sending}
			<Spinner class="h-4 w-4" />
		{:else}
			<SendIcon class="h-4 w-4" />
		{/if}
		<span class="ml-1">{label}</span>
	</Button>
</form>
{#if $composer.error}
	<p class="text-sm text-destructive" data-testid="{testid}-error">
		{$composer.error}
		<button class="ml-2 underline" onclick={() => composer.dismissError()}
			>dismiss</button
		>
	</p>
{/if}
