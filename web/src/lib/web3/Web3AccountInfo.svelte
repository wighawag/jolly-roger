<script lang="ts">
	import Modal from '$lib/components/modals/Modal.svelte';
	import type {account as Account} from './';
	export let account: typeof Account;
</script>

{#if $account.unlocking}
	<Modal
		onResponse={() => {
			account.cancelUnlock();
			return true;
		}}
		settings={{type: 'info', message: 'Please unlock'}}
		cancelation={{clickOutside: false, button: true}}
	/>
{/if}

{#if $account.loadingStep}
	<Modal>
		<h3 class="text-lg font-bold">{$account.loadingStep}</h3>
		<p class="py-4">{$account.loadingStep}</p>
		<div class="modal-action">
			<button on:click={() => account.rejectLoadingStep()} class="btn btn-error">Cancel</button>
			<button on:click={() => account.acceptLoadingStep()} class="btn">Continue</button>
		</div>
	</Modal>
{/if}
