<script lang="ts">
	import Modal from '$lib/components/modals/Modal.svelte';
	import type {account as Account} from './';
	import AccountSignIn from './AccountSignIn.svelte';
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
	{#if $account.loadingStep.id == 'SIGNING'}
		<Modal>
			<h3 class="text-lg font-bold">Welcome to Jolly-Roger</h3>
			<p class="py-4">Sign the message to access to your data.</p>
			<div class="modal-action">
				<button on:click={() => account.rejectLoadingStep()} class="btn btn-error">Cancel</button>
			</div>
		</Modal>
	{:else if $account.loadingStep.id == 'WELCOME'}
		<AccountSignIn {account} />
	{:else}
		<Modal>
			<h3 class="text-lg font-bold">{$account.loadingStep.id}</h3>
			<p class="py-4">{$account.loadingStep.id}</p>
			<div class="modal-action">
				<button on:click={() => account.rejectLoadingStep()} class="btn btn-error">Cancel</button>
				<button on:click={() => account.acceptLoadingStep()} class="btn">Continue</button>
			</div>
		</Modal>
	{/if}
{/if}
