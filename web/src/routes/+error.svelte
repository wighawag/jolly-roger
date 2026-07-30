<script lang="ts">
	import {page} from '$app/state';
</script>

<div class="error-page">
	<h1>{page.status}</h1>
	<h2>
		{#if page.status === 404}
			Page Not Found
		{:else if page.status === 500}
			Server Error
		{:else if page.status === 403}
			Access Denied
		{:else if page.status === 401}
			Unauthorized
		{:else}
			Something Went Wrong
		{/if}
	</h2>
	<p>{page.error?.message || 'An unexpected error occurred'}</p>
	<div class="actions">
		<a href="/">Go Home</a>
		<button onclick={() => window.location.reload()}>Try Again</button>
	</div>
</div>

<style>
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: 2rem;
		text-align: center;
	}
	h1 {
		font-size: 6rem;
		font-weight: 700;
		line-height: 1;
		margin: 0;
		opacity: 0.5;
	}
	h2 {
		margin: 1rem 0 0.5rem;
		font-size: 1.5rem;
	}
	p {
		margin: 0 0 2rem;
		opacity: 0.7;
	}
	.actions {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: center;
	}
	a,
	button {
		padding: 0.5rem 1.5rem;
		border-radius: 0.375rem;
		text-decoration: none;
		cursor: pointer;
		border: 1px solid currentColor;
		background: transparent;
		color: inherit;
		font: inherit;
	}
	a:hover,
	button:hover {
		opacity: 0.8;
	}
</style>
