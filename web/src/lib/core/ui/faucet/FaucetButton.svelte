<script lang="ts">
	import {Button} from '$lib/core/ui/button';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import {getAppContext} from '$lib';
	import {claimFaucet} from './faucet-actions';
	import {PUBLIC_FAUCET_LINK, PUBLIC_FAUCET_API} from '$env/static/public';

	interface Props {
		/**
		 * WHICH account to fund, when it is not the authenticated one.
		 *
		 * Omitted, the faucet funds the account the user signed in as, which is what
		 * every use on this branch wants. It is passed when the button is offered as
		 * the remedy for a specific shortfall, because then the account worth funding
		 * is the account that is short: see `FundsRemedy` in
		 * core/transaction/insufficient-funds-view, which carries the target for
		 * exactly this reason rather than letting the caller pick one.
		 */
		target?: `0x${string}`;
	}

	let {target}: Props = $props();

	const context = getAppContext();
	const {deployments} = context;

	let status = $state<'idle' | 'pending' | 'success' | 'error'>('idle');

	async function openFaucet() {
		status = 'pending';
		try {
			await claimFaucet(
				context,
				{
					faucetApi: PUBLIC_FAUCET_API,
					faucetLink: PUBLIC_FAUCET_LINK,
				},
				target,
			);
			status = 'success';
		} catch {
			status = 'error';
			setTimeout(() => {
				status = 'idle';
			}, 2000);
		}
	}
</script>

<Button
	variant="outline"
	onclick={openFaucet}
	disabled={status === 'pending' || status === 'success'}
	class="w-full gap-2"
>
	{#if status === 'pending'}
		<LoaderIcon class="h-4 w-4 animate-spin" />
	{:else if status === 'success'}
		<CircleCheckIcon class="h-4 w-4 text-green-500" />
	{:else if status === 'error'}
		<CircleXIcon class="h-4 w-4 text-red-500" />
	{:else}
		<ExternalLinkIcon class="h-4 w-4" />
	{/if}
	Get {$deployments.chain.nativeCurrency.symbol}
</Button>
