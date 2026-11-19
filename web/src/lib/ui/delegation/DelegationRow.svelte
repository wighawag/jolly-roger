<script lang="ts">
	import {getAppContext} from '$lib';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import {toast} from 'svelte-sonner';
	import type {DelegationRowView} from './delegation-view';
	import {revokeDelegation} from './revoke';

	let {view}: {view: DelegationRowView} = $props();

	// Every decision about what this says lives in ./delegation-view.ts, and the
	// transaction itself in ./revoke.ts. This holds only whether a click is in
	// flight, which is UI state and nothing else.
	const context = getAppContext();
	const {errorDetails} = context;

	let revoking = $state(false);

	async function revoke() {
		if (revoking) return;
		revoking = true;
		try {
			const result = await revokeDelegation(context);
			if (result.status === 'revoked') {
				toast.success('This browser can no longer post in your name');
			} else if (result.status === 'cannot-send') {
				toast.error(
					'This account cannot send the transaction to withdraw access',
				);
			} else if (result.status === 'error') {
				toast.error('Could not withdraw access', {
					description: result.message,
					closeButton: true,
					action: {
						label: 'Details',
						onClick: () => errorDetails.show(result.details),
					},
				});
			}
		} finally {
			revoking = false;
		}
	}
</script>

{#if view.visible}
	<div
		class="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2"
		data-testid="delegation-row"
		data-authorised={view.authorised}
	>
		<div class="flex items-center justify-between">
			<span class="flex items-center gap-1 text-sm text-muted-foreground">
				<KeyRoundIcon class="h-3.5 w-3.5" />
				Browser access
			</span>
			<span class="text-sm">{view.authorised ? 'Granted' : 'Not granted'}</span>
		</div>

		<p class="text-xs text-muted-foreground">{view.status}</p>

		{#if view.authorised}
			<Button
				size="sm"
				variant="outline"
				class="w-full"
				disabled={!view.canRevoke || revoking}
				onclick={revoke}
				data-testid="revoke-delegation"
			>
				{#if revoking}<Spinner class="h-4 w-4" />{/if}
				Withdraw access
			</Button>
			{#if view.revokeBlockedReason}
				<p class="text-xs text-muted-foreground">{view.revokeBlockedReason}</p>
			{/if}
		{/if}
	</div>
{/if}
