<script lang="ts">
	// THE REAL STYLES, so `pt-[var(--navbar-height)]` and the layer rules resolve
	// to what they resolve to in the app rather than to nothing.
	import '../../../../../src/app.css';
	import AppShell from '$lib/core/ui/AppShell.svelte';

	const {floating}: {floating?: boolean} = $props();
</script>

<AppShell chrome={[]} {floating} routeId={() => '/'}>
	{#snippet navbar()}
		<nav
			data-app-navbar
			class="fixed top-0 left-0 z-50 h-[var(--navbar-height)] w-full"
		>
			navbar
		</nav>
	{/snippet}
	<div class="h-full">page</div>
</AppShell>
