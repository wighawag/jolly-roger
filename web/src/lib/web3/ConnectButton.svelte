<script>
	import {connection, account, pendingActions, network} from './';
	import ImgBlockie from '$lib/components/ethereum/ImgBlockie.svelte';
	import {contractsInfos} from '$lib/config';
	import {getNetworkConfig} from '$lib/blockchain/networks';
</script>

{#if $account.state === 'Disconnected' || $account.locked}
	{#if $account.locked}
		<button class="m-1 btn btn-primary" disabled={$account.unlocking} on:click={() => account.unlock()}>unlock</button>
	{:else}
		<button
			disabled={$connection.connecting}
			class={`${$connection.initialised ? '' : '!invisible'} m-1 btn btn-primary`}
			on:click={() => connection.connect()}>{$connection.connecting ? 'Connecting' : 'Connect'}</button
		>
	{/if}
{:else}
	<!-- <button class="m-2 btn btn-error" on:click={() => connection.disconnect()}>disconnect</button>
			<div class="btn btn-ghost btn-circle avatar">
				<div class="w-10 rounded-full">
					<ImgBlockie address={$account.address || ''} />
				</div>
			</div> -->
	<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
	<!-- svelte-ignore a11y-label-has-associated-control -->
	{#if $network.notSupported}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<svg
			on:click={() => network.switchTo($contractsInfos.chainId, getNetworkConfig($contractsInfos.chainId))}
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke-width="1.5"
			stroke="currentColor"
			class="w-6 h-6"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
			/>
		</svg>
	{/if}
	<div class="dropdown dropdown-end">
		<div class="indicator">
			{#if $pendingActions.list.length > 0}
				<span style="--tw-translate-x: 10;" class="indicator-item badge badge-secondary" />
			{/if}
			<button class="btn btn-ghost btn-circle avatar">
				<div class="w-10 rounded-full">
					<ImgBlockie address={$account.address || ''} />
				</div>
			</button>
		</div>
		<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
		<ul tabindex="0" class="menu menu-compact dropdown-content mt-3 p-2 shadow bg-base-200 rounded-box w-52">
			<li>
				<button class="m-1 btn btn-error text-error-content" on:click={() => connection.disconnect()}>disconnect</button
				>
			</li>
		</ul>
	</div>
{/if}
