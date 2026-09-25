<script lang="ts">
	/**
	 * The layout's arrangement, and nothing else: whatever `chromeFor` resolved,
	 * handed to `SurfaceNavbar` with this app's own navbar as the snippet.
	 *
	 * It mirrors `routes/+layout.svelte` deliberately, which is the one thing a
	 * harness has to get right. If that file ever stops handing the resolved
	 * `navbar` to this component, this harness keeps passing and says nothing -
	 * so the assertion that both are in step is the e2e that measures
	 * `[data-app-navbar]` on a real page, not this file.
	 */
	import type {Component} from 'svelte';
	import SurfaceNavbar from '$lib/ui/navbar/SurfaceNavbar.svelte';

	const {navbar}: {navbar?: Component} = $props();
</script>

<SurfaceNavbar {navbar}>
	{#snippet appNavbar()}
		<nav data-app-navbar data-testid="the-apps-own-navbar">this app</nav>
	{/snippet}
</SurfaceNavbar>
