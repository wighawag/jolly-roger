<script lang="ts">
	import {status, state, syncing} from '$lib/blockchain/state/State';

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

<div
	class={`radial-progress m-2 ${
		$syncing.loading ? 'text-green-400' : $status.state === 'Idle' ? 'text-red-400' : 'text-green-400'
	}`}
	style={`--value:${$syncing.lastSync?.syncPercentage || 0};`}
>
	{$syncing.lastSync?.syncPercentage
		? $syncing.lastSync?.syncPercentage === 100
			? $status.state
			: `${$syncing.lastSync?.syncPercentage}%`
		: '0%'}
</div>

<!-- <progress value={($syncing.lastSync?.syncPercentage || 0) / 100} style="width:100%;" /> -->

<p class="m-1">status: {$status.state}</p>
<p class="m-1">catchingUp: {$syncing.catchingUp}</p>
<p class="m-1">autoIndexing: {$syncing.autoIndexing}</p>
<p class="m-1">fetchingLogs: {$syncing.fetchingLogs}</p>
<p class="m-1">processingFetchedLogs: {$syncing.processingFetchedLogs}</p>

{#if $syncing.numRequests !== undefined}
	<p class="m-1">requests sent: {$syncing.numRequests}</p>
{/if}
<p class="m-1">
	block processed: {$syncing.lastSync?.numBlocksProcessedSoFar?.toLocaleString() || 0}
</p>

<p class="m-1">
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
