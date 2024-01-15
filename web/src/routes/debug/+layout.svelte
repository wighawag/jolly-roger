<script lang="ts">
	import NavTabs from '$lib/components/navigation/NavTabs.svelte';
	import Web3ConnectionUI from '$lib/web3/Web3ConnectionUI.svelte';
</script>

<div>
	<NavTabs
		pages={[
			{pathname: '/debug/indexer/', title: 'Indexer'},
			{pathname: '/debug/contracts/', title: 'Contracts'},
			{pathname: '/debug/transactions/', title: 'Transactions'},
			{pathname: '/debug/utilities/', title: 'Utilities'},
		]}
	/>
</div>

<slot />

<Web3ConnectionUI />
