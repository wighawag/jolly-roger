<script lang="ts">
	

	import {Blockie} from '$lib/utils/eth/blockie';
	interface Props {
		address: string;
		offset?: number;
		style?: string | undefined;
		class?: string;
	}

	let {
		address,
		offset = 0,
		style = undefined,
		class: _class = ''
	}: Props = $props();

	let uri = $derived(Blockie.getURI(address, offset));
</script>

<img class={_class} {style} src={uri} alt={address} />

<style>
	img {
		image-rendering: -moz-crisp-edges;
		image-rendering: -webkit-crisp-edges;
		image-rendering: crisp-edges;
		image-rendering: pixelated;
	}
</style>
