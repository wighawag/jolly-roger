<script lang="ts">
	import {Button} from '$lib/core/ui/button';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import {toast} from 'svelte-sonner';

	interface Props {
		command: string;
		class?: string;
	}

	let {command, class: className = ''}: Props = $props();

	let copied = $state(false);

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(command);
			copied = true;
			toast.success('Copied to clipboard!', {
				description: command,
				duration: 2000,
			});
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			toast.error('Failed to copy', {
				description: 'Please copy the command manually',
			});
		}
	}
</script>

<div
	class="group relative inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-muted/50 px-4 py-3 pr-12 transition-colors hover:border-primary/50 {className}"
>
	<code class="text-sm text-primary md:text-base">
		{command}
	</code>
	<Button
		variant="ghost"
		size="icon"
		class="absolute right-1 h-8 w-8 opacity-70 transition-opacity group-hover:opacity-100"
		onclick={copyToClipboard}
		aria-label="Copy to clipboard"
	>
		{#if copied}
			<CheckIcon class="h-4 w-4 text-green-500" />
		{:else}
			<CopyIcon class="h-4 w-4" />
		{/if}
	</Button>
</div>
