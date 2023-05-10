<script lang="ts">
	import ConnectButton from '$lib/web3/ConnectButton.svelte';
	import Web3ConnectionUI from '$lib/web3/Web3ConnectionUI.svelte';
	import {contracts} from '$lib/web3/viem';
	import {account, connection, network} from '$lib/web3';
	import {status, state} from '$lib/blockchain/state/State';
	import ImgBlockie from '$lib/components/ethereum/ImgBlockie.svelte';

	let messageToSend: string;
</script>

<div class="navbar bg-base-100">
	<div class="navbar-start">
		<span class="normal-case text-xl">Testing</span>
	</div>
	<div class="navbar-center hidden lg:flex" />
	<div class="navbar-end">
		<ConnectButton />
	</div>
</div>

<section class="py-8 px-4">
	<!-- {#if !$messages.step}
		<div>Messages not loaded</div>
	{:else if $messages.error}
		<div>Error: {$messages.error}</div>
		-->
	{#if $connection.state !== 'Connected'}
		Please connect
	{:else if $network.notSupported}
		Wrong network
	{:else if $status.state !== 'Loaded'}
		<div>Loading Messages...</div>
	{/if}
	{#each $state.greetings as greeting, index}
		<!-- <Blockie address={name.id} /> -->
		<div
			class={`flex flex-wrap items-center -mx-2 ${
				$account.address && greeting.account === $account.address ? 'font-bold' : 'font-normal'
			}`}
		>
			<!-- <div class="px-2 mb-6">
						<h2 class="text-xl">{`${name.id.slice(0, 4)}...${name.id.slice(name.id.length - 4)}`} :</h2>
					</div> -->
			<ImgBlockie address={greeting.account} class="m-1 h-6 w-6" />
			<span class="px-2">
				<p>
					{greeting.message}
					<!-- {#if greeting.pending}
						<svg class="fill-current animate-spin inline h-4 w-4"
							><use xlink:href="#icon-spinner6" /></svg
						>
					{/if} -->
				</p>
			</span>
		</div>
	{/each}
	<!-- {/if} -->
</section>

<div class="inline-block form-control w-full max-w-xs">
	<label for="message" class="label !inline">
		<span class="label-text">Say something to the world</span>
	</label>
	<input
		id="message"
		type="text"
		bind:value={messageToSend}
		placeholder="Type here"
		class="!inline input input-bordered w-full max-w-xs"
	/>
</div>
<button
	on:click={() =>
		contracts.execute(async ({contracts}) => {
			contracts.Registry.write({
				functionName: 'setMessage',
				args: [messageToSend, 12],
			});
		})}
	class="m-1 btn btn-primary">Say it!</button
>

<Web3ConnectionUI />
