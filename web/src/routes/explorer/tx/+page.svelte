<script lang="ts">
	import TransactionView from '../components/TransactionView.svelte';
	import {getAppContext} from '$lib';
	import {createHexLocationParamStore} from '../lib/location-param';

	const {navigation} = getAppContext();

	// Read the tx hash from the URL hash or pathname (both IPFS gateway styles).
	const txHash = createHexLocationParamStore(navigation, 'tx');
</script>

<TransactionView txHash={$txHash} />
