<script lang="ts">
	import NavTabs from '$lib/components/navigation/NavTabs.svelte';
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
	}
</style>
