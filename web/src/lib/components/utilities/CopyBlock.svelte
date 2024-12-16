<script lang="ts">
	// based on https://github.com/skeletonlabs/skeleton/blob/58d9780dafd4a7ca04b1086a30aac8c0dc3ce416/src/lib/utilities/CodeBlock/CodeBlock.svelte
	import {createEventDispatcher} from 'svelte';
	import {clipboard} from './clipboard';

	// TODO move to function callback
	const dispatch = createEventDispatcher<{copied: string}>();

	
	interface Props {
		text?: string;
		background?: string;
		copiedBackground?: string;
		boxClass?: string;
		class?: string;
		copiedColor?: string;
		copied?: (str: string) => void;
	}

	let {
		text = '',
		background = '',
		copiedBackground = '',
		boxClass = '',
		class: className = '',
		copiedColor = ''
	}: Props = $props();

	// Local
	let copyState = $state(false);
	function onCopyClick(event: CustomEvent<string>) {
		copyState = true;
		setTimeout(() => {
			copyState = false;
		}, 1000);

		/** @event {{}} copy - Fires when the Copy button is pressed.  */
		dispatch('copied', event.detail);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	role="button"
	tabindex="0"
	class={`${boxClass} ${copyState ? copiedBackground : background}`}
	oncopied={onCopyClick}
	use:clipboard={text}
>
	{#if copyState}
		<code class={`${className} ${copiedColor}`}>Copied ✓</code>
	{:else}
		<code class={className}>{text}</code>
	{/if}
</div>
