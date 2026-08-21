<script lang="ts">
	import AddressView from '../components/AddressView.svelte';
	import {getAppContext} from '$lib';
	import {createHexLocationParamStore} from '../lib/location-param';

	const {navigation} = getAppContext();

	// Read address from the URL hash or pathname (both IPFS gateway styles).
	const address = createHexLocationParamStore(navigation, 'address');
</script>

<AddressView address={$address} />
