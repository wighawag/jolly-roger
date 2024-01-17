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
		<button on:click={() => (onResponse ? onResponse(false) : modalStore.close())} class="close-button">✕</button>
	{/if}
	{#if settings?.type && settings.type !== 'custom'}
		{#if settings.type === 'info'}
			{#if settings.title}
				<h3 class="title">{settings.title}</h3>
			{/if}
			<p class="message">
				{settings.message}
			</p>
		{:else if settings.type === 'confirm'}
			{#if settings.title}
				<h3 class="title">{settings.title}</h3>
			{/if}
			<p class="message">
				{settings.message}
			</p>
			<div class="actions">
				<button on:click={() => (onResponse ? onResponse(false) : modalStore.close())} class="error">Cancel</button>
				<button on:click={() => (onResponse ? onResponse(true) : modalStore.close())} class="success">Confirm</button>
			</div>
		{:else}
			<!-- TODO more -->
			<slot />
		{/if}
	{:else}
		<slot />
	{/if}
</div>

<style>
	.close-button {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
	}

	.title {
		font-size: 1.125rem;
		line-height: 1.75rem;
		font-weight: 700;
	}

	.message {
		padding-top: 1rem;
		padding-bottom: 1rem;
	}
</style>
