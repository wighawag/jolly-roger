<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/core/ui/button';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import {getAppContext} from '$lib';

	const {errorDetails} = getAppContext();

	let copied = $state(false);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// clipboard may be unavailable; ignore
		}
	}
</script>

<Modal.Root
	openWhen={$errorDetails !== null}
	onCancel={() => errorDetails.dismiss()}
>
	{#if $errorDetails}
		<Modal.Title>{$errorDetails.title}</Modal.Title>
		<pre
			class="mt-2 max-h-[50vh] overflow-auto rounded-md border border-input bg-muted/50 p-3 text-left text-xs break-words whitespace-pre-wrap">{$errorDetails.details}</pre>
		<Modal.Footer>
			<Button variant="outline" onclick={() => copy($errorDetails.details)}>
				{#if copied}
					<CheckIcon class="mr-2 h-4 w-4" /> Copied
				{:else}
					<CopyIcon class="mr-2 h-4 w-4" /> Copy
				{/if}
			</Button>
			<Button onclick={() => errorDetails.dismiss()}>Close</Button>
		</Modal.Footer>
	{/if}
</Modal.Root>
