<script lang="ts">
	import Modal from '$lib/components/modals/Modal.svelte';
	import {url} from '$lib/utils/path';
	import {connection} from '.';
</script>

<Modal onResponse={() => connection.cancel()}>
	<div class="title">You need to a web3 wallet to continue</div>
	<div class="download">
		<a href="https://metamask.io/download.html" role="button" class="primary">
			<img alt={`Download Metamask}`} src={url('/images/wallets/metamask.svg')} />
			Download metamask
		</a>
	</div>
</Modal>

<style>
	.title {
		text-align: center;
	}

	.download {
		display: flex;
		justify-content: center;
	}

	.download a {
		margin: 1rem;
		width: max-content;
		height: 3rem;
	}
	.download img {
		object-fit: contain;
		padding: 0;
		margin-left: 0.5rem;
		margin-right: 0.5rem;
		width: 2.5rem;
		height: 2.5rem;
		cursor: pointer;
	}
</style>
