<script lang="ts">
	import Web3Connection from '$lib/web3/Web3Connection.svelte';
	import Modals from '$lib/components/modals/Modals.svelte';
	import {connection, pendingActions, account, network, execution} from '$lib/web3';
</script>

<Web3Connection {connection} {pendingActions} {account} {network} {execution} />

<Modals />
