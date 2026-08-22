<script lang="ts">
	import Head from '$lib/Head.svelte';
	import {page} from '$app/state';
</script>

<Head home={true} title={'Template'} pathname={() => page.url.pathname} />

<h1>Welcome to SvelteKit</h1>
<p>
	Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the
	documentation
</p>
