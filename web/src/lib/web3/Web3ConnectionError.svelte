<script lang="ts">
	import {accountData, type connection as Connection, type network as Network} from './';
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
{:else if $network.genesisChanged}
	<AlertWithSlot>
		<p class="m-2">Chain reset detected! Metamask need to have its account reset!</p>
		<p class="m-2 font-black">
			Click on your account icon, Go to Settings -&gt; Advanced -&gt; Clear Activity Tab Data
		</p>
		<button
			class="btn btn-sm"
			on:click={async () => {
				await network.acknowledgeNewGenesis();
				accountData._reset();
				location.reload();
			}}>I have done it</button
		>
	</AlertWithSlot>
{:else if $network.nonceCached}
	<AlertWithSlot>
		<p class="m-2">Nonce cache detected, Metamask need to have its account reset!</p>
		<p class="m-2 font-black">
			Click on your account icon, Go to Settings -&gt; Advanced -&gt; Clear Activity Tab Data
		</p>
		<button
			class="btn btn-sm"
			on:click={async () => {
				await network.acknowledgeNewGenesis();
				accountData._reset();
				location.reload();
			}}>I have done it</button
		>
	</AlertWithSlot>
{/if}
