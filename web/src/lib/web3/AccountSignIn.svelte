<script lang="ts">
	import Modal from '$lib/components/modals/Modal.svelte';
	import type {account as Account} from './';
	interface Props {
		account: typeof Account;
	}

	let { account }: Props = $props();

	let doNotAskAgainSignature: boolean = $state(false);
</script>

<Modal>
	<h3 class="text-lg font-bold">Welcome to Jolly-Roger</h3>
	<p class="py-4">
		In order to continue and get a safe place to save data, you'll need to sign a message. Be carefull and only sign
		this message on trusted frontend.
	</p>
	<div class="form-control">
		<label class="label cursor-pointer">
			<span class="label-text">Do not ask again (trust computer)</span>
			<input type="checkbox" bind:checked={doNotAskAgainSignature} class="checkbox" />
		</label>
	</div>
	<div class="modal-action">
		<button onclick={() => account.rejectLoadingStep()} class="btn btn-error">Cancel</button>
		<button onclick={() => account.acceptLoadingStep({doNotAskAgainSignature})} class="btn">Sign</button>
	</div>
</Modal>
