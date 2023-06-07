<script lang="ts">
	import {createExecutor} from '$lib/utils/debug';

	let className = '';
	export {className as class};

	export let func: (...args: any[]) => Promise<any>;
	export let args: any[] = [];

	const execution = createExecutor(func);
</script>

<div class={className}>
	{#if $execution.error}
		{$execution.error}
		<button class={`btn btn-error m-2`} on:click={() => execution.acknowledgeError()}>Ok</button>
	{:else}
		<button
			class={`btn btn-secondary ${$execution.executing ? 'btn-disabled' : ''} m-2`}
			on:click={() => execution.execute(args)}><slot /></button
		>
	{/if}
</div>
