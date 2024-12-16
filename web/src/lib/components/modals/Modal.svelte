<script lang="ts">
	import {onMount, onDestroy} from 'svelte';
	import {modalStore} from './stores';
	import type {
		ModalCancelationMode,
		ModalContentSettings,
		ModalCancellationOptions,
		ModalResponseCallback,
	} from './types';
	import ModalContent from './ModalContent.svelte';

	// ----------------------------------------------------------------------------------------------
	// EXPORTS
	
	interface Props {
		// ----------------------------------------------------------------------------------------------
		onResponse?: ModalResponseCallback | undefined;
		settings?: ModalContentSettings | undefined;
		cancelation?: ModalCancellationOptions | undefined;
		children?: import('svelte').Snippet;
	}

	let {
		onResponse = undefined,
		settings = undefined,
		cancelation = undefined,
		children
	}: Props = $props();
	// ----------------------------------------------------------------------------------------------

	let element: HTMLElement = $state();
	onMount(() => {
		modalStore.trigger({
			element,
			response(confirm: boolean, mode?: ModalCancelationMode) {
				if (cancelation) {
					if ('cancelable' in cancelation && cancelation.cancelable) {
						return false;
					}
					if (mode === 'clickOutside') {
						if ('clickOutside' in cancelation) {
							if (!cancelation.clickOutside) {
								return false;
							}
						}
					}
				}

				if (onResponse) {
					const result = onResponse(confirm);
					if (result === undefined) {
						return true;
					} else {
						return result;
					}
				} else {
					return true;
				}
			},
		});
	});

	onDestroy(() => {
		modalStore.close();
	});
</script>

<ModalContent {settings} {cancelation} {onResponse} bind:element>
	{@render children?.()}
</ModalContent>
