<script lang="ts">
	import {onMount} from 'svelte';
	import DefaultHead from '../../lib/metadata/DefaultHead.svelte';
	import Context from '$lib/context/Context.svelte';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import {offlineWorld, startOfflineWorld} from '$lib/offline';
	import Demo from '../demo/+page.svelte';

	// THE ROUTE IS THE CHOOSING AND NOTHING ELSE. Booting a chain, running a
	// deploy and handing the player a wallet are all in `$lib/offline`, which
	// is in turn composition over `$lib/embedded`. A descendant of this
	// template deletes the demo routes it inherits, so anything world-building
	// written in this file would be thrown away by the repos that most want it.
	onMount(() => {
		startOfflineWorld();
	});
</script>

<DefaultHead title={'Offline Demo - a chain in this tab'} />

{#if $offlineWorld.step === 'Ready'}
	<!-- A NESTED PROVIDER, which is the whole mechanism in one element.
	     `setAppContext` is svelte's `setContext`, so this shadows the app's
	     context for THIS SUBTREE only: the page below runs against the chain in
	     the tab while the navbar above still describes the remote one.

	     THAT IS ALSO THE BUG, and it is honest to say so here rather than to
	     leave it to be discovered: the chrome lives in `+layout.svelte`, outside
	     every route subtree, so the account, the balance and the RPC banner up
	     there are still the other world's. Fixing it is upstream work in
	     `lib/core`, which every repo in this tree inherits. -->
	<Context context={$offlineWorld.context}>
		<div
			class="border-b border-dashed border-muted-foreground/40 bg-muted/40 px-4 py-2 text-center text-sm"
		>
			Everything below runs against a chain inside this tab, on chain id
			<code>{$offlineWorld.world.chainId}</code>. The navbar above is still
			describing the remote chain.
		</div>
		<!-- NO CONNECTION FLOW HERE, AND THAT IS THE POINT RATHER THAN AN
		     OMISSION. A flow exists to relay a wallet's questions to the player:
		     which wallet, which account, approve this. A wallet this world
		     GENERATED has no questions - one wallet, one account, and it signs
		     without asking - so mounting one produces three modals that flash
		     past describing decisions nobody is making. Measured: with a flow,
		     "Waiting for Wallet Connection", "Please Accept Connection Request"
		     and "Getting your transaction ready" all appear between click and
		     confirmation; without one, none do and the send is unaffected.

		     An earlier version DID mount one, because without it the world's
		     `ensureConnected()` had no picker and hung. That was true while the
		     world inherited the page's wallets; it stopped being true when the
		     world started bringing its own. Both facts are worth keeping: a
		     nested world that uses the PLAYER's wallet needs its own flow, and
		     one that brings its own must not have it. -->
		<Demo />
	</Context>
{:else if $offlineWorld.step === 'Failed'}
	<div class="container mx-auto max-w-2xl px-4 py-16">
		<div
			class="flex items-start gap-3 rounded-lg border border-destructive/50 p-4"
		>
			<AlertCircleIcon class="mt-0.5 size-5 shrink-0 text-destructive" />
			<div>
				<p class="font-semibold">The offline world did not start.</p>
				<p class="mt-1 text-sm text-muted-foreground">
					{$offlineWorld.error}
				</p>
			</div>
		</div>
	</div>
{:else}
	<div
		class="container mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center"
	>
		<Spinner class="size-6" />
		<p class="text-sm text-muted-foreground">
			{$offlineWorld.step === 'Booting'
				? $offlineWorld.what
				: 'starting a chain in this tab'}&hellip;
		</p>
		<p class="max-w-md text-xs text-muted-foreground">
			A chain is being created in this browser and the app's own deploy scripts
			are being run against it. Nothing leaves the tab.
		</p>
	</div>
{/if}
