<script lang="ts">
	import NavTabs from '$lib/components/daisyui/NavTabs.svelte';
</script>

<header>
	<NavTabs
		pages={[
			{pathname: '/', title: 'Home'},
			{pathname: '/demo/', title: 'Demo'},
			{pathname: '/debug/', title: 'Debug'},
			{pathname: '/about/', title: 'About'},
		]}
	/>
</header>

<style>
	header {
		top: 0;
		position: sticky;
		background-color: var(--color-background-base);
		border-bottom: 2px solid var(--color-background-primary);
	}
</style>
