<script lang="ts">
	// transformed from https://github.com/skeletonlabs/skeleton/blob/58d9780dafd4a7ca04b1086a30aac8c0dc3ce416/src/lib/utilities/CodeBlock/CodeBlock.svelte
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	import { clipboard } from '$lib/actions/clipboard';

	export let text = '';
	export let background = '';
	export let copiedBackground = '';
	export let boxClass = '';
	let className = '';
	export { className as class };
	export let copiedColor = '';

	// Local
	let copyState = false;
	function onCopyClick() {
		copyState = true;
		setTimeout(() => {
			copyState = false;
		}, 1000);

		/** @event {{}} copy - Fires when the Copy button is pressed.  */
		dispatch('copy', {});
	}
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
	class={`${boxClass} ${copyState ? copiedBackground : background}`}
	on:click={onCopyClick}
	use:clipboard={text}
>
	{#if copyState}
		<code class={`${className} ${copiedColor}`}>Copied ✓</code>
	{:else}
		<code class={className}>{text}</code>
	{/if}
</div>
