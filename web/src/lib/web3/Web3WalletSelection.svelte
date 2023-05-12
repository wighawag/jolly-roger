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
		<div class="text-center">
			<p>How do you want to connect ?</p>
		</div>
		<div class="flex flex-wrap justify-center pb-3">
			{#each options as option}
				<!-- TODO handle a11y-->
				<!-- svelte-ignore a11y-click-events-have-key-events-->
				<img
					class="cursor-pointer p-2 m-2 border-2 h-12 w-12 object-contain"
					alt={`Login with ${option.name}`}
					src={url(`/${option.img}`)}
					on:click={() => connection.select(option.id)}
				/>
			{/each}
		</div>
		{#if builtinNeedInstalation}
			<div class="text-center">OR</div>
			<div class="flex justify-center">
				<a href="https://metamask.io/download.html" class="m-4 w-max-content btn btn-primary">
					<img
						class="cursor-pointer p-0 mx-2 h-10 w-10 object-contain"
						alt={`Download Metamask}`}
						src={url('/images/metamask.svg')}
					/>
					Download metamask
				</a>
			</div>
		{/if}
	</Modal>
{/if}
