<script lang="ts">
	import {createEventDispatcher} from 'svelte';
	import ModalContent from './ModalContent.svelte';
	import {modalStore} from './stores';
	import type {ModalCancelationMode, ModalContentSettings} from './types';

	const dispatch = createEventDispatcher();

	let content: HTMLDivElement;
	let settings: ModalContentSettings | undefined = undefined;
	$: if (content && $modalStore[0]) {
		const modal = $modalStore[0];
		if ('element' in modal) {
			if (modal.element.parentNode !== content) {
				while (content.firstChild) {
					content.removeChild(content.firstChild);
				}
				content.appendChild(modal.element);
			}
			settings = undefined;
		} else {
			settings = modal.content;
		}
		for (let i = 1; i < $modalStore.length; i++) {
			const toRemove = $modalStore[i];
			if ('element' in toRemove) {
				if (toRemove.element.parentNode) {
					toRemove.element.parentNode.removeChild(toRemove.element);
				}
			}
		}
	}

	// ----------------------------------------------------------------------------------------------
	// Event Handlers
	// ----------------------------------------------------------------------------------------------
	function onBackdropInteraction(event: MouseEvent | TouchEvent): void {
		if (!(event.target instanceof Element)) {
			return;
		}
		if (event.target.classList.contains('overlay')) {
			cancel('clickOutside');
		}
		/** @event {{ event }} backdrop - Fires on backdrop interaction.  */
		dispatch('backdrop', event);
	}

	function cancel(mode: ModalCancelationMode): void {
		if ($modalStore[0].response) {
			if ($modalStore[0].response(false, mode)) {
				// modalStore.close();
			}
		} else {
			// modalStore.close();
		}
	}

	function confirmAndClose(yes: boolean) {
		if ($modalStore[0].response) {
			if ($modalStore[0].response(yes)) {
				modalStore.close();
			}
		} else {
			modalStore.close();
		}
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (!$modalStore.length) return;
		if (event.code === 'Escape') {
			cancel('esc');
		}
	}
	// ----------------------------------------------------------------------------------------------
</script>

<svelte:window on:keydown={onKeyDown} />

{#if $modalStore.length > 0}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="overlay" on:mousedown={onBackdropInteraction} on:touchstart={onBackdropInteraction}></div>
	<div class="modal" bind:this={content}>
		{#if settings}
			<ModalContent {settings} onResponse={confirmAndClose} />
		{/if}
	</div>
{/if}

<style>
	.overlay {
		position: fixed;

		inset: 0;
		margin: auto;
		width: 100%;
		height: 100%;
		background-color: black;
		opacity: 0.6;
	}

	.modal {
		background-color: var(--color-surface-800);
		border-radius: 1rem;
		padding: 1rem;

		display: grid;
		place-content: center;
		grid-template-columns: 1fr;
		text-align: center;

		position: fixed;

		left: 50%;
		transform: translate(-50%, 0%);
		bottom: 0;
		width: 100%;

		height: 400px;
		max-height: 100%;
	}

	@media (min-width: 640px) {
		.modal {
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);

			width: 600px;
			max-width: 100%;
		}
	}
</style>
