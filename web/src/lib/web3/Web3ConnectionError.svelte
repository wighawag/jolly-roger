<script lang="ts">
	import type {connection as Connection, network as Network} from './';
	export let network: typeof Network;
	export let connection: typeof Connection;
	import AlertWithSlot from '$lib/components/alert/AlertWithSlot.svelte';
	import Alert from '$lib/components/alert/Alert.svelte';
	import {url} from '$lib/utils/path';
	import {resetIndexer} from '$lib/blockchain/state/State';

	const builtin = connection.builtin;
</script>

{#if $connection.error}
	<!-- TODO remove or retest-->
	<!-- {#if $connection.error?.code == 7221}
		<AlertWithSlot onClose={connection.acknowledgeError}>
			{#if $builtin.vendor === 'Metamask'}
				<p>
					Metamask is not responding. See <a
						class="link"
						href="https://github.com/MetaMask/metamask-extension/issues/7221"
						target="_blank"
						rel="noreferrer">github issue</a
					>. Please
					<a class="link" on:click={() => location.reload()} href=".">reload</a>
				</p>
			{:else}
				<p>
					Your Wallet is not responding. Please <a class="link" on:click={() => location.reload()} href=".">reload.</a>
				</p>
			{/if}
		</AlertWithSlot>
	{:else} -->
	<Alert data={$connection.error} onClose={connection.acknowledgeError} />
	<!-- {/if} -->
{:else if $network.nonceCached === 'BlockOutOfRangeError' || $network.genesisNotMatching || $network.blocksCached}
	<AlertWithSlot>
		<p class="m-2">
			{$builtin.vendor === 'Metamask' ? 'Block cache detected, Metamask  😭' : 'Block cache detected'}
		</p>

		<p class="m-2 font-black">You'll need to shutdown and reopen your browser</p>
		<button class="btn block mt-3" tabindex="0" on:click={() => location.reload()}> Else Try Reload? </button>
	</AlertWithSlot>
{:else if $network.hasEncounteredBlocksCacheIssue}
	<AlertWithSlot>
		<p class="m-2">You seemed to have recovered from Block Cacke Issue</p>

		<p class="m-2 font-black">You most likely need to clear any data dervided from the chain as it may be invalid.</p>
		<button
			class="btn block mt-3"
			tabindex="0"
			on:click={() => resetIndexer().then(() => network.acknowledgeBlockCacheIssue())}
		>
			Clear
		</button>
	</AlertWithSlot>
{:else if $network.nonceCached === 'cache'}
	<AlertWithSlot>
		<p class="m-2">
			{$builtin.vendor === 'Metamask'
				? 'Nonce cache detected, Metamask need to have its accounts reset 😭'
				: 'Nonce cache detected. Please clear your account data.'}
		</p>
		{#if $builtin.vendor === 'Metamask'}
			<p class="m-2 font-black">
				Click on the Metamask extension icon:
				<img class="inline w-6 h-6 mx-2" src={url('/images/wallets/metamask.svg')} alt="Metamask extension" />
				then open the menu
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.5"
					stroke="currentColor"
					class="w-6 h-6 inline"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
					/>
				</svg> &gt; Settings &gt; Advanced &gt; Clear Activity Tab Data
			</p>
		{/if}
	</AlertWithSlot>
{/if}
