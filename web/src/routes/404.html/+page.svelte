<script lang="ts">
	import {page} from '$app/stores';
</script>

<!-- TODO inject some script tag in the generated build/404.html -->
<!-- <script src={url('/404.js')} /> -->
<!-- if (!isSameRoute($page.url.pathname, '/404.html/')) {
	newURL = route(`/404.html/?notfound=${$page.url.pathname}`);
	location.href = newURL;
} -->

<section>
	<div class="wrapper">
		<p class="text">
			Could not find the page {$page.params.notfound || ''}
		</p>
	</div>
</section>

<style>
	section {
		padding-top: 0.5rem;
		padding-bottom: 0.5rem;
		padding-left: 1rem;
		padding-right: 1rem;
		text-align: center;
	}
	.wrapper {
		max-width: fit-content;
		margin-inline: auto;
	}

	@media (min-width: 768px) {
		.wrapper {
			max-width: 32rem;
		}
	}

	.text {
		text-align: center;
		margin-top: 2rem;
		margin-bottom: 2rem;
		margin-left: 0.5rem;

		font-weight: 900;

		font-size: 1.5rem;
		line-height: 2rem;
	}
</style>
