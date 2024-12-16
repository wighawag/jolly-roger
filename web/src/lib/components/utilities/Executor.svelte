<script lang="ts">
	import {createExecutor} from '$lib/utils/debug';

	

	interface Props {
		class?: string;
		func: (...args: any[]) => Promise<any>;
		args?: any[];
		children?: import('svelte').Snippet;
	}

	let {
		class: className = '',
		func,
		args = [],
		children
	}: Props = $props();

	const execution = createExecutor(func);
</script>

<div class={className}>
	{#if $execution.error}
		{$execution.error}
		<button class={`btn btn-error m-2`} onclick={() => execution.acknowledgeError()}>Ok</button>
	{:else}
		<button
			class={`btn btn-secondary ${$execution.executing ? 'btn-disabled' : ''} m-2`}
			onclick={() => execution.execute(args)}>{@render children?.()}</button
		>
	{/if}
</div>
