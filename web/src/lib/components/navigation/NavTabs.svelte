<script lang="ts">
	import PageLink from './PageLink.svelte';
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
		margin: 0;
		list-style-type: none;
		padding: 8px 8px 0px 0px;
		background-color: var(--color-surface-500);
		border-bottom: 4px solid var(--color-primary-500);
	}
</style>
