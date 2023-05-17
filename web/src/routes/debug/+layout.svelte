<script lang="ts">
	import NavTabs from '$lib/components/daisyui/NavTabs.svelte';
	import ConnectButton from '$lib/web3/ConnectButton.svelte';
	import Web3ConnectionUI from '$lib/web3/Web3ConnectionUI.svelte';
</script>

<NavTabs
	class="tabs"
	tabClass="tab tab-sm tab-lifted"
	whenSelected="tab-active"
	pages={[
		{pathname: '/debug/indexer/', title: 'Indexer'},
		{pathname: '/debug/contracts/', title: 'Contracts'},
		{pathname: '/debug/transactions/', title: 'Transactions'},
	]}
/>

<div class="float-right mr-2 mt-2">
	<ConnectButton />
</div>

<slot />

<Web3ConnectionUI />
