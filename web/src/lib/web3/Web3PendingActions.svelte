<script lang="ts">
	import type {pendingActions as PendingActions} from './';
	export let pendingActions: typeof PendingActions;
	import Modal from '$lib/components/modals/Modal.svelte';
	import {modalStore} from '$lib/components/modals/stores';
</script>

{#if $pendingActions.list.length > 0}
	<Modal
		onResponse={() => {
			// in case the tx is rejected while showing that confirmation modal
			// we need to close it
			// TODO have modal id to ensure we close the right one
			const unsubscribe = pendingActions.subscribe((p) => {
				if (p.list.length === 0) {
					modalStore.close();
				}
			});
			modalStore.trigger({
				response: (yes) => {
					unsubscribe();
					if (yes) {
						pendingActions.skip();
					}
					return true;
				},
				content: {
					type: 'confirm',
					message: 'Are you sure?',
				},
			});
		}}
		cancelation={{button: true, clickOutside: false}}
	>
		{#if $pendingActions.list[0].item.metadata && $pendingActions.list[0].item.metadata.title}
			<h3 class="text-lg font-bold">
				{$pendingActions.list[0].item.metadata.title}
			</h3>
		{/if}
		<p class="py-4">
			{#if $pendingActions.list[0].item.metadata && $pendingActions.list[0].item.metadata.description}
				{$pendingActions.list[0].item.metadata.description}
			{:else}
				'Please confirm or reject the request on your wallet.'
			{/if}
		</p>
	</Modal>
{/if}
