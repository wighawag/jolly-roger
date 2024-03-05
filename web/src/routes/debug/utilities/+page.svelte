<script lang="ts">
	import Executor from '$lib/components/utilities/Executor.svelte';
	import {time} from '$lib/time';
	import {createExecutor, enableAnvilLogging, increaseBlockTime} from '$lib/utils/debug';
	import DebugWrapper from '../DebugWrapper.svelte';

	$: date = new Date($time.timestamp * 1000);

	let hours = 1;
</script>

<DebugWrapper>
	<p slot="title">Date/Time: {date.toLocaleDateString() + `  ` + date.toLocaleTimeString()}</p>

	<Executor func={increaseBlockTime} args={[1 * 3600]}>Add 1 hours</Executor>
	<Executor func={increaseBlockTime} args={[23 * 3600]}>Add 23 hours</Executor>
	<form class="add-x-hours">
		<label for="hours" />
		<input id="hours" type="number" bind:value={hours} />
		<Executor func={increaseBlockTime} args={[hours * 3600]}>Add {hours} hours</Executor>
	</form>
</DebugWrapper>

<!-- <Executor func={enableAnvilLogging}>Enable Anvil Logging</Executor> -->

<style>
	.add-x-hours {
		display: flex;
		flex-wrap: wrap;
	}

	.add-x-hours input {
		background-color: black;
		color: white;
	}
</style>
