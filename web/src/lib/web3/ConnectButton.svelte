<script lang="ts">
	import {connection, account, pendingActions, network} from './';
	import ImgBlockie from '$lib/components/ethereum/ImgBlockie.svelte';
	import {contractsInfos} from '$lib/config';
	import {getNetworkConfig} from '$lib/blockchain/networks';

	let open = false;

	function disconnect() {
		open = false;
		connection.disconnect();
	}

	function switchMenu(e: Event) {
		open = !open;
		e.stopPropagation();
		e.preventDefault();
	}

	function closeMenu() {
		open = false;
	}
</script>

<svelte:window on:click={(e) => closeMenu()} />

{#if $account.state === 'Disconnected' || $account.locked}
	{#if $account.locked}
		<button class="primary" disabled={$account.unlocking} on:click={() => account.unlock()}>unlock</button>
	{:else}
		<button
			disabled={$connection.connecting}
			class={`${$connection.initialised ? '' : 'invisible'} primary`}
			on:click={() => connection.connect()}>{$connection.connecting ? 'Connecting' : 'Connect'}</button
		>
	{/if}
{:else}
	<div class="connected">
		{#if $network.notSupported}
			<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
			<!-- svelte-ignore a11y-label-has-associated-control -->
			<!-- svelte-ignore a11y-click-events-have-key-events -->
			<svg
				role="button"
				tabindex="0"
				on:click={() => network.switchTo($contractsInfos.chainId, getNetworkConfig($contractsInfos.chainId))}
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke-width="1.5"
				stroke="currentColor"
				class="font-icon"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
				/>
			</svg>
		{/if}
		<div class="dropdown">
			<!-- TODO -->
			<!-- {#if $pendingActions.list.length > 0}
			<span style="--tw-translate-x: 10;" class="indicator-item badge badge-secondary" />
		{/if} -->
			<button class="blockie-button" on:click={(e) => switchMenu(e)}>
				<div class="blockie-wrapper">
					<ImgBlockie rootClass="blockie" address={$account.address || ''} />
				</div>
			</button>
			{#if open}
				<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
				<ul tabindex="0" class="menu">
					<li>
						<button class="error" on:click={() => disconnect()}>disconnect</button>
					</li>
				</ul>
			{/if}
		</div>
	</div>
{/if}

<style>
	.connected {
		text-align: right;
		width: 5.5rem;
	}

	.dropdown {
		display: inline;
	}

	.font-icon {
		width: 2rem;
		height: 2rem;
	}
	.menu {
		position: absolute;
		display: flex;
		justify-content: center;
		right: 0;
		list-style: none;
		padding: 16px;
		border-radius: 16px;
		box-shadow:
			4px 6px 3px 0 rgb a(1, 0, 0, 0.1),
			4px 6px 2px 0 rgba(0, 0, 0, 0.06);

		background-color: var(--color-surface-800);
	}

	.menu button {
		display: inline-block;
	}

	.blockie-button {
		width: 3rem;
		height: 3rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding-inline: revert;
	}
	.blockie-wrapper {
		border-radius: 9999px;
		overflow: hidden;

		aspect-ratio: 1 / 1;
		width: 2.5rem;
	}

	.blockie-wrapper :global(.blockie) {
		object-fit: cover;
		height: 100%;
		width: 100%;
	}
</style>
