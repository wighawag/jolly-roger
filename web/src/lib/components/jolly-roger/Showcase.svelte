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
	<div class="image-wrapper">
		<a {href} target="_blank" rel="noreferrer"><img src={url(preview)} alt={name} /></a>
	</div>
	<div class="info-wrapper">
		<div class="info">
			<p class="name"><a {href} target="_blank" rel="noreferrer">{name}</a></p>
			<div class="card-content">
				<p class="card-title">{title}</p>
				<p class="card-description">{description}</p>
				<p class="card-source">
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
		overflow: hidden;
		flex-direction: column;
		border-radius: 0.5rem;
		box-shadow:
			0 10px 15px -3px rgba(0, 0, 0, 0.1),
			0 4px 6px -2px rgba(0, 0, 0, 0.05);

		background-color: var(--color-surface-700);
	}

	.image-wrapper {
		flex-shrink: 0;
	}

	.image-wrapper img {
		object-fit: cover;
		width: 100%;
		height: 12rem;
	}

	.info-wrapper {
		display: flex;
		padding: 1.5rem;
		flex-direction: column;
		flex: 1 1 0%;
		justify-content: space-between;
	}

	.info {
		flex: 1;
	}

	.name {
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 500;
	}
	.name a {
		color: var(--color-primary-500);
	}

	.card-content {
		display: block;
		margin-top: 0.5rem;
	}

	.card-title {
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 600;
	}

	.card-description,
	.card-source {
		margin-top: 0.75rem;
		font-size: 1rem;
		line-height: 1.5rem;
	}

	.card-source a {
		text-decoration: underline;
	}
</style>
