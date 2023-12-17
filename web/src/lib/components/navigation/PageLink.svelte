<script lang="ts">
	import {page} from '$app/stores';
	import {route, isParentRoute, isSameRoute} from '$lib/utils/path';

	export let href: string;

	$: current = href === '/' ? isSameRoute($page.url.pathname, href) : isParentRoute($page.url.pathname, href);
</script>

<a class:current href={route(href)}><slot /></a>

<style>
	a {
		display: inline-block;
		padding: 0.5em;
		color: var(--color-text-base);
	}

	.current {
		color: var(--color-text-primary);
		background-color: var(--color-background-primary);
	}
</style>
