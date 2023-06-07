<script lang="ts">
	import Executor from '$lib/components/utilities/Executor.svelte';
	import {time, phase} from '$lib/time';
	import {createExecutor, enableAnvilLogging, increaseBlockTime} from '$lib/utils/debug';
	// import {increaseDungeonTime} from '$lib/utils/dungeon';

	let error: any;
	let state: 'addTime' | undefined;

	async function addTime(numHours: number) {
		try {
			state = 'addTime';
			await increaseBlockTime(numHours * 3600);
		} catch (err) {
		} finally {
			state = undefined;
		}
	}

	// async function addDungeonTime(numHours: number) {
	// 	try {
	// 		state = 'addTime';
	// 		await increaseDungeonTime(numHours * 3600);
	// 	} catch (err) {
	// 	} finally {
	// 		state = undefined;
	// 	}
	// }

	$: date = new Date($time.timestamp * 1000);

	let hours = 1;

	// const execute_increaseBlockTime = createExecutor(increaseDungeonTime);
	const execute_increaseBlockTime = createExecutor(increaseBlockTime);
</script>

<label class="m-2 font-bold" for="date">Date/Time</label>
<p class="m-2" id="date">{date.toLocaleDateString() + `  ` + date.toLocaleTimeString()}</p>

{#if error}
	{error.message}
	<button class={`btn btn-error m-2`} on:click={() => (error = undefined)}>OK</button>
{:else}
	<button class={`btn btn-secondary ${state ? 'btn-disabled' : ''} m-2`} on:click={() => addTime(1)}>Add 1 hour</button>
	<button class={`btn btn-secondary ${state ? 'btn-disabled' : ''} m-2`} on:click={() => addTime(23)}
		>Add 23 hour</button
	>
	<form>
		<label for="hours" />
		<input id="hours" type="number" bind:value={hours} />
		<button class={`btn btn-secondary ${state ? 'btn-disabled' : ''} m-2`} type="submit" on:click={() => addTime(hours)}
			>Add {hours} hours</button
		>
	</form>

	<hr />

	<!-- <button class={`btn btn-secondary ${state ? 'btn-disabled' : ''} m-2`} on:click={() => addDungeonTime(1)}
		>Dungeon: Add 1 hour</button
	>
	<button class={`btn btn-secondary ${state ? 'btn-disabled' : ''} m-2`} on:click={() => addDungeonTime(23)}
		>Dungeon: Add 23 hour</button
	> -->
	<!-- <form>
		<label for="hours" />
		<input id="hours" type="number" bind:value={hours} />
		<button
			class={`btn btn-secondary ${state ? 'btn-disabled' : ''} m-2`}
			type="submit"
			on:click={() => addDungeonTime(hours)}>Dungeon: Add {hours} hours</button
		>
	</form> -->

	<div class="card-actions justify-end">
		{#if $execute_increaseBlockTime.error}
			{$execute_increaseBlockTime.error}
			<button class={`btn btn-error m-2`} on:click={() => execute_increaseBlockTime.acknowledgeError()}>Ok</button>
		{:else}
			<button
				class={`btn btn-secondary ${$execute_increaseBlockTime.executing ? 'btn-disabled' : ''} m-2`}
				on:click={() => execute_increaseBlockTime.execute($phase.timeLeftToCommit)}>Switch to Reveal Phase</button
			>
			<button
				class={`btn btn-secondary ${$execute_increaseBlockTime.executing ? 'btn-disabled' : ''} m-2`}
				on:click={() => execute_increaseBlockTime.execute($phase.timeLeftToReveal)}>Switch to Commit Phase</button
			>
		{/if}

		<!-- <button class="btn btn-primary" on:click={() => commit()}>Commit</button> -->
		<!-- <button class="btn btn-ghost" on:click={() => reset()}>Reset</button> -->
	</div>
{/if}

<Executor func={enableAnvilLogging}>Enable Anvil Logging</Executor>
