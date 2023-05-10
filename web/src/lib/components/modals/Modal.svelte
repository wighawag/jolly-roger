<script lang="ts">
	import {onMount} from 'svelte';
	import {onDestroy} from 'svelte/internal';
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
	// ----------------------------------------------------------------------------------------------
	export let onResponse: ModalResponseCallback | undefined = undefined;
	export let settings: ModalContentSettings | undefined = undefined;
	export let cancelation: ModalCancellationOptions | undefined = undefined;
	// ----------------------------------------------------------------------------------------------

	let element: HTMLElement;
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
	<slot />
</ModalContent>
