<script lang="ts">
	import {page} from '$app/stores';
	import {route, isSameRoute} from '$lib/utils/path';

	export let href: string;
	let className = '';
	export {className as class};
	export let whenSelected: string = '';
	export let whenUnselected: string = '';
</script>

<a href={route(href)} class={`${className} ${isSameRoute($page.url.pathname, href) ? whenSelected : whenUnselected}`}
	><slot /></a
>
