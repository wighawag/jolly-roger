<script lang="ts">
	import {status, state, syncing} from '$lib/blockchain/state/State';
	import RadialProgress from '$lib/components/progress/RadialProgress.svelte';
	import DebugWrapper from '../DebugWrapper.svelte';

	// import JSONTree from 'svelte-json-tree';

	function addLengthToFields(v: any): any {
		const keys = Object.keys(v);
		const n = {};
		for (const key of keys) {
			if (typeof v[key] === 'object') {
				(n as any)[key + ` (${Object.keys(v[key]).length})`] = v[key];
			} else {
				(n as any)[key] = v[key];
			}
		}
		return n;
	}
	$: stateDisplayed = $state && addLengthToFields($state);
</script>

<DebugWrapper>
	<p slot="title">Indexer State</p>

	<RadialProgress value={$syncing.lastSync?.syncPercentage || 0} />

	<p>status: {$status.state}</p>
	<p>catchingUp: {$syncing.catchingUp}</p>
	<p>autoIndexing: {$syncing.autoIndexing}</p>
	<p>fetchingLogs: {$syncing.fetchingLogs}</p>
	<p>processingFetchedLogs: {$syncing.processingFetchedLogs}</p>

	{#if $syncing.numRequests !== undefined}
		<p>requests sent: {$syncing.numRequests}</p>
	{/if}
	<p>
		block processed: {$syncing.lastSync?.numBlocksProcessedSoFar?.toLocaleString() || 0}
	</p>

	<p>
		latestBlock: {$syncing.lastSync?.latestBlock || 0}
	</p>

	<div class="mt-4 text-center w-full">State</div>

	{#if $state}
		<code class="m-2 block bg-base-300">
			{JSON.stringify(stateDisplayed, (key, value) => (typeof value === 'bigint' ? value.toString() : value), 2)}
		</code>
	{:else}
		{JSON.stringify($syncing)}
	{/if}
</DebugWrapper>

<style>
	p {
		margin-block: 1rem;
	}
</style>
