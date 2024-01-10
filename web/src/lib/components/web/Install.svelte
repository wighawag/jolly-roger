<script lang="ts">
	import localCache from '$lib/utils/localCache';
	import PromptCard from '../prompts/PromptCard.svelte';

	export let src: string;
	export let alt: string;

	type BeforeInstallPromptEvent = Event & {
		prompt: () => void;
		userChoice: Promise<{outcome: string}>;
	};

	let show = false;

	let deferredPrompt: BeforeInstallPromptEvent;
	function getVisited() {
		return localCache.getItem('install-prompt') === 'true';
	}
	function setVisited() {
		localCache.setItem('install-prompt', 'true');
	}
	function beforeinstallprompt(event: Event) {
		event.preventDefault();
		deferredPrompt = event as BeforeInstallPromptEvent;
	}
	function decline() {
		show = false;
		setVisited();
	}
	function skip() {
		show = false;
	}
	function install() {
		show = false;
		setVisited();
		deferredPrompt.prompt();
		deferredPrompt.userChoice.then(() => {
			// (choice) => {}
			// TODO ?
		});
	}
	function trigger() {
		if (!getVisited() && performance.now() > 2000) {
			setTimeout(() => (show = true), 1000);
		}
	}
</script>

<svelte:window on:beforeinstallprompt={beforeinstallprompt} on:click={skip} on:scroll={trigger} />

{#if deferredPrompt && show}
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
		<PromptCard {src} {alt} on:accept={install} on:reject={decline}>
			Do you want to install Jolly Roger on your home screen?
			<span slot="accept">Install</span>
			<span slot="reject">Decline</span>
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
