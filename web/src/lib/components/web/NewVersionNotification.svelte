<script lang="ts">
	import {serviceWorker} from '$lib/web/serviceWorker';

	export let src: string;
	export let alt: string;

	function skip() {
		$serviceWorker.updateAvailable = false;
	}

	function reload() {
		if ($serviceWorker.updateAvailable && $serviceWorker.registration) {
			if ($serviceWorker.registration.waiting) {
				$serviceWorker.registration.waiting.postMessage('skipWaiting');
			} else {
				console.error(`not waiting..., todo reload?`);
				// window.location.reload();
			}
			$serviceWorker.updateAvailable = false;
		}
	}
</script>

<!-- <svelte:window on:click={skip} /> -->

<!-- {#if $serviceWorker.updateAvailable && $serviceWorker.registration} -->
<!-- svelte-ignore a11y-click-events-have-key-events-->
<div
	role="button"
	tabindex="0"
	on:click={(e) => {
		e.preventDefault();
		e.stopPropagation();
	}}
	class="overlay"
>
	<div class="wrapper-2">
		<div style="padding: 1rem">
			<div class="wrapper-3">
				<div class="image-container">
					<img class="logo" {src} {alt} />
				</div>
				<div class="content">
					<div class="text">A new version is available. Reload to get the update.</div>
					<div class="buttons-container">
						<button on:click={reload} type="button" class="button success"> Reload </button>
						<button on:click={skip} type="button" class="button error"> Skip </button>
					</div>
				</div>
				<div class="close-button-wrapper">
					<button on:click={skip} class="button button-close">
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
			</div>
		</div>
	</div>
</div>

<!-- {/if} -->

<style lang="css">
	.overlay {
		/* z-50 fixed inset-0 flex items-end justify-center px-4 py-6 pointer-events-none sm:p-6 sm:items-start sm:justify-end */
		z-index: 9999;
		position: fixed;
		inset: 0;
		pointer-events: none;

		display: flex;
		align-items: flex-end;
		justify-content: center;

		padding-inline: 1rem;
		padding-block: 1.5rem;
	}

	@media (min-width: 640px) {
		.overlay {
			align-items: flex-start;
			justify-content: flex-end;

			padding: 1.5rem;
		}
	}

	.wrapper-2 {
		/* max-w-sm w-full shadow-lg rounded-lg pointer-events-auto bg-base-300 */
		max-width: 24rem;
		width: 100%;
		box-shadow:
			0 10px 15px -3px rgba(0, 0, 0, 0.1),
			0 4px 6px -2px rgba(0, 0, 0, 0.05);
		border-radius: 0.5rem;
		pointer-events: auto;
		background-color: var(--color-background-base-3);
		/* border: 1px solid white; */
	}

	.wrapper-3 {
		/* flex items-start */
		display: flex;
		align-items: flex-start;
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

	.button {
		/* btn rounded-btn btn-success btn-sm m-1 */
		display: inline-flex;
		align-items: center;
		justify-content: center;

		cursor: pointer;
		-webkit-user-select: none;
		user-select: none;

		border-radius: 0.5rem;

		line-height: 1em;
		font-weight: 600;
		text-decoration-line: none;

		height: 2rem;
		min-height: 2rem;
		padding-inline: 0.75rem;
		font-size: 0.875rem;
	}

	.success {
		color: var(--color-text-success);
		background-color: var(--color-background-success);
	} /* TODO hover */

	.error {
		color: var(--color-text-error);
		background-color: var(--color-background-error);
	} /* TODO hover */

	.close-button-wrapper {
		/* ml-4 flex-shrink-0 flex */
		display: flex;
		flex-shrink: 0;
		margin-left: 1rem;
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
