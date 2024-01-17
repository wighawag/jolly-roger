<script lang="ts">
	import {createExecutor} from '$lib/utils/debug';

	export let func: (...args: any[]) => Promise<any>;
	export let args: any[] = [];

	const execution = createExecutor(func);
</script>

<div>
	{#if $execution.error}
		{$execution.error}
		<button class="error" on:click={() => execution.acknowledgeError()}>Ok</button>
	{:else}
		<button disabled={$execution.executing} class="success" on:click={() => execution.execute(...args)}><slot /></button
		>
	{/if}
</div>

<style>
	button {
		margin: 0.5rem;
	}
</style>
