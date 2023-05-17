<script lang="ts">
	import {network} from '$lib/web3';

	$: contractList = $network.contracts
		? Object.keys($network.contracts).map((v) => ({name: v, contract: ($network.contracts as any)[v]}))
		: undefined;
</script>

{#if contractList}
	<ul>
		{#each contractList as contract}
			<li>{contract.name}: {contract.contract.address}</li>
		{/each}
	</ul>
{/if}
