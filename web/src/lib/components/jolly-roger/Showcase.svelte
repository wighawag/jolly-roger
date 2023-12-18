<script lang="ts">
	import {url} from '$lib/utils/path';

	export let href: string;
	export let preview: string;
	export let name: string;
	export let title: string;
	export let description: string;
	export let source: string | undefined = undefined;
</script>

<div class="wrapper">
	<div>
		<a {href} target="_blank" rel="noreferrer"><img src={url(preview)} alt={name} /></a>
	</div>
	<div class="info-wrapper">
		<div class="info">
			<p><a {href} target="_blank" rel="noreferrer">{name}</a></p>
			<div>
				<p>{title}</p>
				<p>{description}</p>
				<p>
					{#if source}
						Check the <a href={source} target="_blank" rel="noreferrer">source code</a>.
					{:else}Source code not yet available.{/if}
				</p>
			</div>
		</div>
	</div>
</div>

<style>
	.wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.wrapper img {
		object-fit: cover;
	}

	.info-wrapper {
		display: flex;
		flex-direction: column;
	}

	.info {
		flex: 1;
	}
</style>
