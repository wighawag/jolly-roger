<script lang="ts">
	import {page} from '$app/stores';
	import {route, isParentRoute, isSameRoute} from '$lib/utils/path';

	
	interface Props {
		href: string;
		class?: string;
		whenSelected?: string;
		whenUnselected?: string;
		children?: import('svelte').Snippet;
	}

	let {
		href,
		class: className = '',
		whenSelected = '',
		whenUnselected = '',
		children
	}: Props = $props();
</script>

<a
	href={route(href)}
	class={`${className} ${
		(href === '/' ? isSameRoute($page.url.pathname, href) : isParentRoute($page.url.pathname, href))
			? whenSelected
			: whenUnselected
	}`}>{@render children?.()}</a
>
