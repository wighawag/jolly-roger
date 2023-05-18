<script lang="ts">
	import PageLink from '$lib/components/navigation/PageLink.svelte';

	let className = 'bg-base-100 tabs-boxed';
	export {className as class};
	export let tabClass: string = 'tab text-base-content';
	export let whenSelected: string = 'tab-active font-black';
	export let whenUnselected: string = '';

	export let pages: {pathname: string; title: string}[];
</script>

<div class={`tabs ${className}`}>
	{#each pages as page}
		<PageLink class={tabClass} {whenUnselected} {whenSelected} href={page.pathname}>{page.title}</PageLink>
	{/each}
</div>
