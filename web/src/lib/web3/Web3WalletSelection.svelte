<script lang="ts">
	import type {connection as Connection} from './';
	export let connection: typeof Connection;
	import {url} from '$lib/utils/path';
	import Modal from '$lib/components/modals/Modal.svelte';

	const builtin = connection.builtin;

	$: builtinNeedInstalation =
		(connection.options.filter((v) => v === 'builtin').length > 0 || connection.options.length === 0) &&
		!$builtin.available;

	$: options = connection.options
		.filter((v) => v !== 'builtin' || $builtin.available)
		.map((v) => {
			return {
				img: ((v) => {
					if (v === 'builtin') {
						if ($builtin.state === 'Ready') {
							if ($builtin.vendor === 'Metamask') {
								return 'images/wallets/metamask.svg';
							} else if ($builtin.vendor === 'Opera') {
								return 'images/wallets/opera.svg';
							} else if ($builtin.vendor === 'Brave') {
								return 'images/wallets/brave.svg';
							}
						}
						return 'images/wallets/web3-default.png';
					} else {
						if (v.startsWith('torus-')) {
							const verifier = v.slice(6);
							return `images/wallets/torus/${verifier}.svg`;
						}
						return `images/wallets/${v}.svg`;
					}
				})(v),
				id: v,
				name: v,
			};
		});
</script>

{#if $connection.requireSelection}
	<Modal onResponse={() => connection.cancel()}>
		<div class="title">
			<p>How do you want to connect ?</p>
		</div>
		<div class="options-list">
			{#each options as option}
				<!-- TODO handle a11y-->
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions
permalink-->
				<img
					alt={`Login with ${option.name}`}
					src={url(`/${option.img}`)}
					on:click={() => connection.select(option.id)}
				/>
			{/each}
		</div>
		{#if builtinNeedInstalation}
			<div class="title">OR</div>
			<div class="download">
				<a href="https://metamask.io/download.html" role="button" class="primary">
					<img alt={`Download Metamask}`} src={url('/images/wallets/metamask.svg')} />
					Download metamask
				</a>
			</div>
		{/if}
	</Modal>
{/if}

<style>
	.title {
		text-align: center;
	}

	.options-list {
		display: flex;
		padding-bottom: 0.75rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.options-list img {
		object-fit: contain;
		padding: 0.5rem;
		margin: 0.5rem;
		width: 3rem;
		height: 3rem;
		border-width: 2px;
		cursor: pointer;
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
