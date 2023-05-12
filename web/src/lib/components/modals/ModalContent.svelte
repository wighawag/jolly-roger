<script lang="ts">
	import {modalStore} from './stores';
	import type {ModalCancellationOptions, ModalContentSettings, ModalResponseCallback} from './types';
	import {focusTrap} from '$lib/components/utilities/focusTrap';

	// ----------------------------------------------------------------------------------------------
	// EXPORTS
	// ----------------------------------------------------------------------------------------------
	export let element: HTMLElement | undefined = undefined;
	export let onResponse: ModalResponseCallback | undefined;
	export let settings:
		| ModalContentSettings
		| {
				type: 'custom';
		  }
		| undefined = undefined;
	export let cancelation: ModalCancellationOptions | undefined = undefined;

	$: showCancelButton =
		!(cancelation && (cancelation as any).cancelable === false) &&
		cancelation &&
		'button' in cancelation &&
		cancelation.button;
	// ----------------------------------------------------------------------------------------------
</script>

<div bind:this={element} use:focusTrap={true}>
	{#if showCancelButton}
		<button
			on:click={() => (onResponse ? onResponse(false) : modalStore.close())}
			class="btn btn-sm btn-circle absolute right-2 top-2">✕</button
		>
	{/if}
	{#if settings?.type && settings.type !== 'custom'}
		{#if settings.type === 'info'}
			{#if settings.title}
				<h3 class="text-lg font-bold">{settings.title}</h3>
			{/if}
			<p class="py-4">
				{settings.message}
			</p>
		{:else if settings.type === 'confirm'}
			{#if settings.title}
				<h3 class="font-bold text-lg">{settings.title}</h3>
			{/if}
			<p class="py-4">
				{settings.message}
			</p>
			<div class="modal-action">
				<button on:click={() => (onResponse ? onResponse(false) : modalStore.close())} class="btn btn-error"
					>Cancel</button
				>
				<button on:click={() => (onResponse ? onResponse(true) : modalStore.close())} class="btn btn-success"
					>Confirm</button
				>
			</div>
		{:else}
			<!-- TODO more -->
			<slot />
		{/if}
	{:else}
		<slot />
	{/if}
</div>
