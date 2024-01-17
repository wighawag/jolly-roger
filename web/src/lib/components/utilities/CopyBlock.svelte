<script lang="ts">
	// based on https://github.com/skeletonlabs/skeleton/blob/58d9780dafd4a7ca04b1086a30aac8c0dc3ce416/src/lib/utilities/CodeBlock/CodeBlock.svelte
	import {createEventDispatcher} from 'svelte';
	import {clipboard} from './clipboard';

	const dispatch = createEventDispatcher<{copied: string}>();

	export let text = '';

	// Local
	let copyState = false;
	function onCopyClick(event: CustomEvent<string>) {
		copyState = true;
		setTimeout(() => {
			copyState = false;
		}, 1000);

		/** @event {{}} copy - Fires when the Copy button is pressed.  */
		dispatch('copied', event.detail);
	}
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div role="button" tabindex="0" on:copied={onCopyClick} use:clipboard={text}>
	{#if copyState}
		<code class="copied">Copied ✓</code>
	{:else}
		<code class="tocopy">{text}</code>
	{/if}
</div>

<style>
	code {
		text-align: center;
		display: block;
		line-height: 1.7;
		font-size: large;
		font-weight: bold;
		background-color: var(--color-surface-600);
		padding: 12px;
		border-radius: 1em;
	}

	.copied {
		background-color: var(--color-success-500);
		color: black;
	}

	.tocopy {
		color: var(--color-primary-500);
	}
</style>
