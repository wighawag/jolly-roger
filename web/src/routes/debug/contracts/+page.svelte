<script lang="ts">
	import {network} from '$lib/web3';
	import DebugWrapper from '../DebugWrapper.svelte';

	$: contractList = $network.contracts
		? Object.keys($network.contracts).map((v) => ({name: v, contract: ($network.contracts as any)[v]}))
		: undefined;
</script>

<DebugWrapper>
	<p slot="title">Contracts</p>
	{#if contractList}
		<ul>
			{#each contractList as contract}
				<li>{contract.name}: {contract.contract.address}</li>
			{/each}
		</ul>
	{/if}
</DebugWrapper>

<style>
	ul {
		margin-left: 1rem;
	}
</style>
