<script lang="ts">
	import {contractsInfos} from '$lib/config';
	import {getNetworkConfig} from '$lib/blockchain/networks';
	import Modal from '$lib/components/modals/Modal.svelte';
	import type {connection as Connection, execution as Execution, network as Network, account as Account} from './';

	export let connection: typeof Connection;
	export let account: typeof Account;
	export let execution: typeof Execution;
	export let network: typeof Network;
</script>

{#if $execution.executing}
	{#if $network.notSupported}
		<Modal cancelation={{cancelable: false}}>
			<h3 class="title">You are connected to unsupported network</h3>
			<p class="message">
				Proceed to switch to {getNetworkConfig($contractsInfos.chainId)?.chainName ||
					`the network with chainID: ${$contractsInfos.chainId}`}.
			</p>
			<div class="modal-action">
				<button
					on:click={async () => {
						await execution.cancel();
					}}
					class="error">Cancel</button
				>
				<button
					on:click={() => network.switchTo($contractsInfos.chainId, getNetworkConfig($contractsInfos.chainId))}
					class="success">Switch</button
				>
			</div>
		</Modal>
	{:else if $account.isLoadingData}
		<Modal cancelation={{cancelable: false}} settings={{type: 'info', message: $account.isLoadingData}} />
		<!-- TODO account need to be connected -->
	{:else if $account.state === 'Disconnected' && !$account.unlocking}
		<Modal cancelation={{cancelable: false}}>
			<h3 class="title">To proceed, you need to connect to a wallet.</h3>
			<div class="modal-action">
				<button
					on:click={async () => {
						await execution.cancel();
					}}
					class="error">Cancel</button
				>
				<button
					disabled={$connection.connecting}
					class={`${$connection.initialised ? '' : '!invisible'} m-1 button primary`}
					on:click={() => connection.connect()}>{$connection.connecting ? 'Connecting' : 'Connect'}</button
				>
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
