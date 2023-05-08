<script lang="ts">
	import type { connection as Connection } from './';
	export let connection: typeof Connection;
	import AlertWithSlot from '$lib/components/alert/AlertWithSlot.svelte';
	import Alert from '$lib/components/alert/Alert.svelte';

	const builtin = connection.builtin;
</script>

{#if $connection.error}
	{#if $connection.error?.code == 7221}
		<AlertWithSlot onClose={connection.acknowledgeError}>
			{#if $builtin.vendor === 'Metamask'}
				<p>
					Metamask is not responding. See <a
						class="link"
						href="https://github.com/MetaMask/metamask-extension/issues/7221"
						target="_blank"
						rel="noreferrer">github issue</a
					>. Please <a class="link" on:click={() => location.reload()} href=".">reload</a>
				</p>
			{:else}
				<p>
					Your Wallet is not responding. Please <a
						class="link"
						on:click={() => location.reload()}
						href=".">reload.</a
					>
				</p>
			{/if}
		</AlertWithSlot>
	{:else}
		<Alert data={$connection.error} onClose={connection.acknowledgeError} />
	{/if}
{/if}
