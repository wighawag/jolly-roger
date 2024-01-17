<script lang="ts">
	import Modal from '$lib/components/modals/Modal.svelte';
	import type {account as Account} from './';
	export let account: typeof Account;

	let doNotAskAgainSignature: boolean = false;
</script>

<Modal>
	<h3 class="title">Welcome to Jolly-Roger</h3>
	<p class="message">
		In order to continue and get a safe place to save data, you'll need to sign a message. Be carefull and only sign
		this message on trusted frontend.
	</p>
	<div class="form-control">
		<label>
			<span class="label-text">Do not ask again (trust computer)</span>
			<input type="checkbox" bind:checked={doNotAskAgainSignature} class="checkbox" />
		</label>
	</div>
	<div class="actions">
		<button on:click={() => account.rejectLoadingStep()} class="error">Cancel</button>
		<button on:click={() => account.acceptLoadingStep({doNotAskAgainSignature})} class="success">Sign</button>
	</div>
</Modal>

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

	label {
		cursor: pointer;
	}
</style>
