<script lang="ts">
	import {page} from '$app/stores';
	import {isSameRoute, route} from '$lib/utils/path';
	import {onMount} from 'svelte';
	let newURL: string | undefined;
	onMount(() => {
		if (!isSameRoute($page.url.pathname, '/404.html/')) {
			newURL = route(`/404.html/?notfound=${$page.url.pathname}`);
			location.href = newURL;
		}
	});
</script>

<section class="py-2 px-4 text-center">
	<div class="max-w-auto md:max-w-lg mx-auto">
		<p class="!text-2xl flex justify-center space-x-2 font-black my-8">
			Could not find the page {$page.params.notfound || ''}
		</p>
	</div>
</section>
