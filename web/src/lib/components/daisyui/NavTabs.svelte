<script lang="ts">
	import PageLink from '$lib/components/navigation/PageLink.svelte';

	

	interface Props {
		class?: string;
		tabClass?: string;
		whenSelected?: string;
		whenUnselected?: string;
		pages: {pathname: string; title: string}[];
	}

	let {
		class: className = 'bg-base-100 tabs-boxed',
		tabClass = 'tab text-base-content',
		whenSelected = 'tab-active font-black',
		whenUnselected = '',
		pages
	}: Props = $props();
</script>

<div class={`tabs ${className}`}>
	{#each pages as page}
		<PageLink class={tabClass} {whenUnselected} {whenSelected} href={page.pathname}>{page.title}</PageLink>
	{/each}
</div>
