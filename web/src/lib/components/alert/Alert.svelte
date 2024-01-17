<script lang="ts">
	export let data: {title?: string; message: string; code?: number};
	export let onClose: (() => void) | undefined = undefined;
</script>

<div class="banner error" role="alert">
	<p>
		<strong>{data.title ? data.title : data.message}</strong>
	</p>
	{#if data.title}
		<p>
			<span class="message">{data.message}</span>
		</p>
	{/if}

	{#if onClose}
		<!-- svelte-ignore a11y-click-events-have-key-events-->
		<span role="button" tabindex="0" class="close-button" on:click={() => onClose && onClose()}>
			<svg class="font-icon" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
				><title>Close</title><path
					d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"
				/></svg
			>
		</span>
	{/if}
</div>

<style lang="css">
	.banner {
		width: auto;
		left: 0px;
		right: 0px;
		max-width: 100%;
		z-index: 1001;

		position: fixed;
		top: 0;
		margin: 0.5rem;

		padding-block: 0.75rem;
		padding-inline: 1rem;

		border-width: 2px;
		border-radius: 1rem;
	}

	.message {
		display: block;

		@media (min-width: 640px) {
			display: inline;
		}
	}

	.font-icon {
		width: 1.5rem;
		height: 1.5rem;
		fill: currentColor;
	}

	.close-button {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		padding-top: 0.75rem;
		padding-bottom: 0.75rem;
		padding-left: 1rem;
		padding-right: 1rem;
	}
</style>
