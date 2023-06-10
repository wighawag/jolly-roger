<script lang="ts">
	import {page} from '$app/stores';
</script>

<!-- TODO inject some script tag in the generated build/404.html -->
<!-- <script src={url('/404.js')} /> -->
<!-- if (!isSameRoute($page.url.pathname, '/404.html/')) {
	newURL = route(`/404.html/?notfound=${$page.url.pathname}`);
	location.href = newURL;
} -->

<section class="py-2 px-4 text-center">
	<div class="max-w-auto md:max-w-lg mx-auto">
		<p class="!text-2xl flex justify-center space-x-2 font-black my-8">
			Could not find the page {$page.params.notfound || ''}
		</p>
	</div>
</section>
