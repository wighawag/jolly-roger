<script lang="ts">
	import {createEventDispatcher} from 'svelte';
	import {fade, fly} from 'svelte/transition';
	import ModalContent from './ModalContent.svelte';
	import {modalStore} from './stores';
	import type {ModalCancelationMode, ModalContentSettings} from './types';

	// ----------------------------------------------------------------------------------------------
	// EXPORTS
	// ----------------------------------------------------------------------------------------------
	export let duration = 150;
	export let flyOpacity = 0;
	export let flyX = 0;
	export let flyY = 100;
	// ----------------------------------------------------------------------------------------------

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
		if (event.target.classList.contains('modal')) {
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
	<div
		style="pointer-events: auto; visibility: visible; opacity: 1;"
		class="modal modal-bottom sm:modal-middle cursor-pointer"
		on:mousedown={onBackdropInteraction}
		on:touchstart={onBackdropInteraction}
		transition:fade={{duration}}
	>
		<div
			class="modal-box relative"
			style="--tw-translate-y:0;"
			transition:fly={{duration, opacity: flyOpacity, x: flyX, y: flyY}}
			bind:this={content}
		>
			{#if settings}
				<ModalContent {settings} onResponse={confirmAndClose} />
			{/if}
		</div>
	</div>
{/if}
