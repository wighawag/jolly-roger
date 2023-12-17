<script lang="ts">
	import PageLink from '$lib/components/navigation/PageLink.svelte';
	export let pages: {pathname: string; title: string}[];
</script>

<nav>
	<ol>
		{#each pages as page}
			<li><PageLink href={page.pathname}>{page.title}</PageLink></li>
		{/each}
	</ol>
</nav>

<style>
	nav ol {
		display: flex;
		justify-content: flex-start;
		gap: 16px;
		list-style-type: none;
		padding: 0;
		margin: 0;
	}
</style>
