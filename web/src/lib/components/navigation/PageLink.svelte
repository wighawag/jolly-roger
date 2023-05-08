<script lang="ts">
	import { page } from '$app/stores';
	import { pathname, isSameURL } from '$lib/utils/url';

	export let href: string;
	let className = '';
	export { className as class };
	export let whenSelected: string = '';
	export let whenUnselected: string = '';
</script>

<a
	href={pathname(href)}
	class={`${className} ${isSameURL($page.url.pathname, href) ? whenSelected : whenUnselected}`}
	><slot /></a
>
