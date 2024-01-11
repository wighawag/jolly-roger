<script lang="ts">
	import ConnectButton from '$lib/web3/ConnectButton.svelte';
	import Web3ConnectionUI from '$lib/web3/Web3ConnectionUI.svelte';
	import {account, connection, network, contracts} from '$lib/web3';
	import {status, state} from '$lib/blockchain/state/State';
	import {viewState} from '$lib/blockchain/state/ViewState';
	import ImgBlockie from '$lib/components/ethereum/ImgBlockie.svelte';

	let messageToSend: string;
</script>

<div class="top-bar">
	<div>
		<span class="title">Demo</span>
	</div>

	<ConnectButton />
</div>

<symbol id="icon-spinner6" viewBox="0 0 32 32">
	<path
		d="M12 4c0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.209-1.791 4-4 4s-4-1.791-4-4zM24.719 16c0 0 0 0 0 0 0-1.812 1.469-3.281 3.281-3.281s3.281 1.469 3.281 3.281c0 0 0 0 0 0 0 1.812-1.469 3.281-3.281 3.281s-3.281-1.469-3.281-3.281zM21.513 24.485c0-1.641 1.331-2.972 2.972-2.972s2.972 1.331 2.972 2.972c0 1.641-1.331 2.972-2.972 2.972s-2.972-1.331-2.972-2.972zM13.308 28c0-1.487 1.205-2.692 2.692-2.692s2.692 1.205 2.692 2.692c0 1.487-1.205 2.692-2.692 2.692s-2.692-1.205-2.692-2.692zM5.077 24.485c0-1.346 1.092-2.438 2.438-2.438s2.438 1.092 2.438 2.438c0 1.346-1.092 2.438-2.438 2.438s-2.438-1.092-2.438-2.438zM1.792 16c0-1.22 0.989-2.208 2.208-2.208s2.208 0.989 2.208 2.208c0 1.22-0.989 2.208-2.208 2.208s-2.208-0.989-2.208-2.208zM5.515 7.515c0 0 0 0 0 0 0-1.105 0.895-2 2-2s2 0.895 2 2c0 0 0 0 0 0 0 1.105-0.895 2-2 2s-2-0.895-2-2zM28.108 7.515c0 2.001-1.622 3.623-3.623 3.623s-3.623-1.622-3.623-3.623c0-2.001 1.622-3.623 3.623-3.623s3.623 1.622 3.623 3.623z"
	/>
</symbol>

<section class="messages-section">
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
	{#each $viewState.greetings as greeting, index}
		<!-- <Blockie address={name.id} /> -->
		<div
			class={`message ${
				$account.address && greeting.account.toLowerCase() === $account.address ? 'font-bold' : 'font-normal'
			}`}
		>
			<!-- <div class="px-2 mb-6">
						<h2 class="text-xl">{`${name.id.slice(0, 4)}...${name.id.slice(name.id.length - 4)}`} :</h2>
					</div> -->
			<ImgBlockie address={greeting.account} rootClass="blockie" />
			<span class="message-text">
				<p>
					{greeting.message}
					{#if greeting.pending}
						<svg class="spinner"><use xlink:href="#icon-spinner6" /></svg>
					{/if}
				</p>
			</span>
		</div>
	{/each}
	<!-- {/if} -->
</section>

<div class="message-input">
	<label for="message">
		<span>Say something to the world</span>
	</label>
	<input id="message" type="text" bind:value={messageToSend} placeholder="Type here" class="input" />
</div>
<button
	on:click={() =>
		contracts.execute(async ({contracts, connection, account}) => {
			// we can add metadata to our tx that can get picked up
			connection.provider.setNextMetadata({
				type: 'message',
				message: messageToSend,
			});

			contracts.Registry.write.setMessage([messageToSend, 12]);
		})}
	class="button primary">Say it!</button
>

<Web3ConnectionUI />

<style>
	.messages-section {
		padding-left: 1rem;
		padding-right: 1rem;
		padding-top: 2rem;
		padding-bottom: 2rem;
	}

	.message {
		display: flex;
		margin-left: -0.5rem;
		margin-right: -0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.message :global(.blockie) {
		width: 1rem;
		aspect-ratio: 1 / 1;
	}

	.message-text {
		padding-left: 0.5rem;
		padding-right: 0.5rem;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.spinner {
		display: inline;
		width: 1rem;
		height: 1rem;
		animation: spin 1s linear infinite;
		fill: currentColor;
	}

	.font-bold {
		font-weight: bold;
	}

	.font-normal {
		font-weight: normal;
	}
	.top-bar {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem;
	}

	.title {
		font-size: 1.25rem;
		line-height: 1.75rem;
		text-transform: none;
	}

	.message-input {
		padding-left: 1rem;
		padding-right: 1rem;
		padding-top: 2rem;
		padding-bottom: 2rem;

		display: inline-block;
		width: 100%;
		max-width: 20rem;
	}

	.input {
		background-color: black;
		color: white;
		width: 100%;
		max-width: 20rem;
	}

	.button {
		max-width: 20rem;
	}
</style>
