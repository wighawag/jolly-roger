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
			<h3 class="title">Welcome to Jolly-Roger</h3>
			<p class="message">Sign the message to access to your data.</p>
			<div class="modal-action">
				<button on:click={() => account.rejectLoadingStep()} class="error">Cancel</button>
			</div>
		</Modal>
	{:else if $account.loadingStep.id == 'WELCOME'}
		<AccountSignIn {account} />
	{:else}
		<Modal>
			<h3 class="title">{$account.loadingStep.id}</h3>
			<p class="message">{$account.loadingStep.id}</p>
			<div class="modal-action">
				<button on:click={() => account.rejectLoadingStep()} class="error">Cancel</button>
				<button on:click={() => account.acceptLoadingStep()} class="success">Continue</button>
			</div>
		</Modal>
	{/if}
{/if}

<style>
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
