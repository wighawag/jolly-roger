<!--
	Renders `component` with `innerProps` under a provided block explorer, the way the
	app's root layout provides it (`provideBlockExplorer` in routes/+layout.svelte).
-->
<script lang="ts">
	import type {Component} from 'svelte';
	import {provideBlockExplorer} from '$lib/core/capabilities';
	import type {BlockExplorer} from '$lib/core/utils/ethereum/blockExplorer';

	let {
		explorer,
		component: Inner,
		innerProps,
	}: {
		explorer: BlockExplorer;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		component: Component<any>;
		innerProps: Record<string, unknown>;
	} = $props();

	// svelte-ignore state_referenced_locally
	provideBlockExplorer(explorer);
</script>

<Inner {...innerProps} />
