<script lang="ts">
	import {status, state, syncing} from '$lib/blockchain/state/State';
	import ConnectButton from '$lib/web3/ConnectButton.svelte';
	import Web3ConnectionUI from '$lib/web3/Web3ConnectionUI.svelte';

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

<div class="navbar bg-base-100">
	<div class="navbar-start">
		<span class="normal-case text-xl">Testing</span>
	</div>
	<div class="navbar-center hidden lg:flex" />
	<div class="navbar-end">
		<ConnectButton />
	</div>
</div>

<progress value={($syncing.lastSync?.syncPercentage || 0) / 100} style="width:100%;" />

<p>status: {$status.state}</p>
<p>loading: {$syncing.loading}</p>
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

{#if $state}
	{JSON.stringify(
		stateDisplayed,
		(key, value) => (typeof value === 'bigint' ? value.toString() : value) // return everything else unchanged
	)}
{:else}
	{JSON.stringify($syncing)}
{/if}

<Web3ConnectionUI />
