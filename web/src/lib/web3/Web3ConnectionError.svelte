<script lang="ts">
	import type {connection as Connection, network as Network} from './';
	export let network: typeof Network;
	export let connection: typeof Connection;
	import AlertWithSlot from '$lib/components/alert/AlertWithSlot.svelte';
	import Alert from '$lib/components/alert/Alert.svelte';

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
{:else if $network.genesisNotMatching}
	<AlertWithSlot>
		<p class="m-2">Chain reset detected! Metamask need to have its account reset!</p>
		<p class="m-2 font-black">
			Click on your account icon, Go to Settings -&gt; Advanced -&gt; Clear Activity Tab Data
		</p>
		<!-- <button
			class="btn btn-sm"
			on:click={async () => {
				await network.notifyThatCacheHasBeenCleared();
				accountData._reset();
				location.reload();
			}}>I have done it</button
		> -->
	</AlertWithSlot>
{:else if $network.nonceCached === 'BlockOutOfRangeError'}
	<AlertWithSlot>
		<p class="m-2">Block cache detected, Metamask need to have its account reset!</p>
		<p class="m-2 font-black">
			Click on your account icon, Go to Settings -&gt; Advanced -&gt; Clear Activity Tab Data
		</p>
	</AlertWithSlot>
{:else if $network.nonceCached === 'cache'}
	<AlertWithSlot>
		<p class="m-2">Nonce cache detected, Metamask need to have its account reset!</p>
		<p class="m-2 font-black">
			Click on your account icon, Go to Settings -&gt; Advanced -&gt; Clear Activity Tab Data
		</p>
	</AlertWithSlot>
{:else if $network.genesisChanged}
	<div
		style="width: auto; left: 0px; right: 0px; max-width: 100%;"
		class="m-2 fixed z-50 top-0 alert alert-warning shadow-lg"
	>
		<div>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="stroke-current flex-shrink-0 h-6 w-6"
				fill="none"
				viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/></svg
			>
			<span>Warning: Network Reset</span>
		</div>

		<!-- svelte-ignore a11y-click-events-have-key-events-->
		<span class="absolute top-0 bottom-0 right-0 px-4 py-3" on:click={() => network.acknowledgeNewGenesis()}>
			<svg class="fill-current h-6 w-6" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
				><title>Close</title><path
					d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"
				/></svg
			>
		</span>
	</div>
{/if}
