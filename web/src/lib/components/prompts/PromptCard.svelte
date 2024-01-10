<script lang="ts">
	export let src: string;
	export let alt: string;

	import {createEventDispatcher} from 'svelte';

	const dispatch = createEventDispatcher();
</script>

<div class="card">
	<div class="image-container">
		<img class="logo" {src} {alt} />
	</div>
	<div class="content">
		<div class="text"><slot /></div>
		<div class="buttons-container">
			<button on:click={() => dispatch('accept')} type="button" class="button success"
				><slot name="accept">Accept</slot></button
			>
			<button on:click={() => dispatch('reject')} type="button" class="button error"
				><slot name="reject">Reject</slot>
			</button>
		</div>
	</div>
	<button on:click={() => dispatch('reject')} class="button button-close">
		<span class="sr-only">Close</span>
		<!-- Heroicon name: solid/x -->
		<svg
			class="font-icon"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>
</div>

<style lang="css">
	.card {
		max-width: 24rem;
		width: 100%;
		box-shadow:
			0 10px 15px -3px rgba(0, 0, 0, 0.1),
			0 4px 6px -2px rgba(0, 0, 0, 0.05);
		border-radius: 0.5rem;
		pointer-events: auto;
		background-color: var(--color-background-base-3);

		display: flex;
		align-items: flex-start;

		padding: 1rem;
	}

	.image-container {
		/* flex-shrink-0 pt-0.5 */
		padding-top: 0.125rem;
		flex-shrink: 0;
	}

	.logo {
		/* h-16 w-16 rounded-box border-2 border-base-200 */
		width: 4rem;
		height: 4rem;
		border-width: 2px;
		border-radius: 1rem;
		border-color: var(--color-background-base-2); /* TODO */
	}

	.content {
		/* ml-3 w-0 flex-1 */
		margin-left: 0.75rem;
		flex: 1 1 0%;
		width: 0;
	}

	.text {
		/* text-base font-medium */
		color: var(--color-text-base);
		font-size: 1rem;
		line-height: 1.5rem;
		font-weight: 500;
	}

	.buttons-container {
		/* mt-4 flex */
		display: flex;
		margin-top: 1rem;
		gap: 1rem;
	}

	.button-close {
		color: var(--color-text-base);
		background-color: var(--color-background-base);
	}

	.font-icon {
		min-width: 1.2rem;
		min-height: 1.2rem;
	}
</style>
