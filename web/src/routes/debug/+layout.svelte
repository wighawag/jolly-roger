<script lang="ts">
	import NavTabs from '$lib/components/daisyui/NavTabs.svelte';
	import ConnectButton from '$lib/web3/ConnectButton.svelte';
	import Web3ConnectionUI from '$lib/web3/Web3ConnectionUI.svelte';
</script>

<div>
	<NavTabs
		class="w-full flex-grow-0 bg-opacity-100 bg-base-300"
		tabClass="tab tab-sm tab-lifted flex-1"
		whenSelected="tab-active font-black !bg-base-100"
		pages={[
			{pathname: '/debug/indexer/', title: 'Indexer'},
			{pathname: '/debug/contracts/', title: 'Contracts'},
			{pathname: '/debug/transactions/', title: 'Transactions'},
			{pathname: '/debug/utilities/', title: 'Utilities'},
		]}
	/>

	<div class="float-right mr-2 mt-2">
		<ConnectButton />
	</div>
</div>

<slot />

<Web3ConnectionUI />
