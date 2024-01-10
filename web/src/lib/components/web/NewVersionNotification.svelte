<script lang="ts">
	import {serviceWorker} from '$lib/web/serviceWorker';
	import PromptCard from '../prompts/PromptCard.svelte';

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

{#if $serviceWorker.updateAvailable && $serviceWorker.registration}
	<!-- svelte-ignore a11y-click-events-have-key-events-->
	<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		tabindex="0"
		on:click={(e) => {
			console.log(e);
			e.preventDefault();
			e.stopPropagation();
		}}
		class="overlay"
	>
		<PromptCard {src} {alt} on:accept={reload} on:reject={skip}>
			A new version is available. Reload to get the update.
			<span slot="accept">Reload</span>
			<span slot="reject">Skip</span>
		</PromptCard>
	</div>
{/if}

<style lang="css">
	.overlay {
		z-index: 9999;
		position: fixed;
		inset: 0;
		pointer-events: none;
		/* cursor: revert; */

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
</style>
