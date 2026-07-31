<script lang="ts">
	import {getAppContext} from '$lib';
	import Button from '$lib/shadcn/ui/button/button.svelte';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';

	const {nonceCache} = getAppContext();

	// Only the two actionable states surface a banner. `undefined` (unknown) and
	// `false` (healthy) render nothing. The store is a no-op outside dev/app-RPC,
	// so this component is inert in production.
	let show = $derived(
		$nonceCache.status === 'cache' ||
			$nonceCache.status === 'block-out-of-range',
	);
</script>

{#if show}
	<div
		class="sticky top-12 z-40 flex w-full items-center justify-between gap-3 border-b border-red-900 bg-red-950 px-4 py-2"
	>
		<div class="flex items-center gap-2">
			<AlertTriangleIcon class="h-4 w-4 shrink-0 text-red-400" />
			<span class="text-sm text-red-400">
				{#if $nonceCache.status === 'cache'}
					Your wallet has a cached nonce for this network{#if $nonceCache.walletNonce !== undefined && $nonceCache.nodeNonce !== undefined}
						(wallet {$nonceCache.walletNonce} &gt; node {$nonceCache.nodeNonce}){/if}. Transactions will stay pending and never mine. Reset /
					clear this account's activity data in your wallet (the node was
					likely restarted).
				{:else}
					Your wallet cached a block height beyond this node (the node was
					likely restarted). Reset / clear this account's activity data in your
					wallet.
				{/if}
			</span>
		</div>
		<Button
			variant="outline"
			size="sm"
			class="shrink-0 border-red-700 text-red-400 hover:bg-red-900"
			onclick={() => nonceCache.recheck()}
		>
			Re-check
		</Button>
	</div>
{/if}
