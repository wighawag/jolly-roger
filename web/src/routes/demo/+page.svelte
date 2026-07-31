<script lang="ts">
	import DefaultHead from '../../lib/metadata/DefaultHead.svelte';
	import {Button} from '$lib/shadcn/ui/button';
	import {Input} from '$lib/shadcn/ui/input';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import SendIcon from '@lucide/svelte/icons/send';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import {getAppContext} from '$lib';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import EthereumAvatar from '$lib/core/ui/ethereum/EthereumAvatar.svelte';
	import {toast} from 'svelte-sonner';
	import {setGreeting as submitGreeting} from './lib/setGreeting';
	import {formatRelativeTime, getStaleMessage} from './lib/staleness';

	const context = getAppContext();
	const {
		refreshChainData,
		canReadChain,
		connection,
		viewState,
		clock,
		accountCannotSend,
		errorDetails,
	} = context;

	const viewStatus = viewState.status;

	// Whether the app can read the chain yet (app RPC, or a connected wallet).
	// When it cannot, the not-loaded state prompts the user to connect.
	let canRead = $derived($canReadChain);

	// Derive stale message so it updates when status store updates
	// Note: clock will become a store that updates every second in the future
	let staleMessage = $derived(
		getStaleMessage($viewStatus.lastSuccessfulFetch, clock.now()),
	);

	let greetingInput = $state('');
	let isSubmitting = $state(false);

	async function setGreeting() {
		if (!greetingInput.trim() || isSubmitting) return;

		isSubmitting = true;
		try {
			const result = await submitGreeting(context, greetingInput);
			if (result.status === 'submitted') {
				greetingInput = '';
			} else if (result.status === 'cannot-send') {
				accountCannotSend.show();
			} else if (result.status === 'error') {
				toast.error('Transaction failed', {
					description: result.message,
					duration: 8000,
					closeButton: true,
					action: {
						label: 'Details',
						onClick: () => errorDetails.show(result.details),
					},
				});
			}
		} finally {
			isSubmitting = false;
		}
	}
</script>

<DefaultHead title={'Demo - Greetings Registry'} />

<div class="container mx-auto max-w-2xl px-4 py-8">
	<div class="space-y-6">
		<!-- Title Section -->
		<div class="text-center">
			<h1 class="text-3xl font-bold tracking-tight">Greetings Registry</h1>
			<p class="mt-2 text-muted-foreground">
				This is a demo of a simple on-chain greetings registry. Connect your
				wallet and share your greeting with the world!
			</p>
		</div>

		<!-- Input Section -->
		<form
			class="flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				setGreeting();
			}}
		>
			<Input
				type="text"
				placeholder="Enter your greeting..."
				bind:value={greetingInput}
				disabled={isSubmitting}
				class="flex-1"
			/>
			<Button
				type="submit"
				disabled={isSubmitting || !greetingInput.trim()}
				size="sm"
			>
				{#if isSubmitting}
					<Spinner class="h-4 w-4" />
				{:else}
					<SendIcon class="h-4 w-4" />
				{/if}
				<span class="ml-1">Send</span>
			</Button>
		</form>

		<!-- Messages List -->
		<div class="space-y-3">
			{#if $viewStatus.error && $viewState.step === 'Unloaded'}
				<!-- Errored initial load. The error persists while a retry is in flight
				     (see polling-store), so show a "Refreshing..." affordance instead of
				     flipping away, and only offer Retry once settled. -->
				<div
					class="flex flex-col items-center justify-center py-8 text-destructive"
				>
					<AlertCircleIcon class="mb-3 h-10 w-10" />
					<p class="text-base">Failed to load messages</p>
					<p
						class="line-clamp-3 max-w-full overflow-hidden text-sm wrap-break-word text-ellipsis text-muted-foreground"
					>
						{$viewStatus.error.message}
					</p>
					{#if $viewStatus.loading}
						<span
							class="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
						>
							<Spinner class="h-4 w-4" /> Refreshing...
						</span>
					{:else}
						<Button
							variant="outline"
							onclick={() => refreshChainData()}
							class="mt-4"
						>
							Retry
						</Button>
					{/if}
				</div>
			{:else if $viewState.step === 'Unloaded' && $viewStatus.loading}
				<!-- Initial loading -->
				<div
					class="flex flex-col items-center justify-center py-8 text-muted-foreground"
				>
					<Spinner class="mb-3 h-10 w-10" />
					<p class="text-base">Loading messages...</p>
				</div>
			{:else if $viewState.step === 'Unloaded'}
				<!-- Not loaded: never fetched. If we cannot read the chain yet (no app
				     RPC and no wallet), prompt the user to connect; otherwise it is just
				     a transient not-loaded state. Distinct from a completed fetch that
				     returned zero messages (the "be the first" empty state below). -->
				<div
					class="flex flex-col items-center justify-center py-8 text-muted-foreground"
				>
					<MessageSquareIcon class="mb-3 h-10 w-10" />
					{#if !canRead}
						<p class="text-base">Connect to load messages</p>
						<p class="mt-1 text-sm">
							Connect your wallet to fetch greetings from the network.
						</p>
						<Button class="mt-4" onclick={() => connection.connect()}>
							Connect Wallet
						</Button>
					{:else}
						<p class="text-base">Messages not loaded</p>
					{/if}
				</div>
			{:else}
				<!-- Loaded - $viewState.step === 'Loaded' -->
				{#if $viewState.messages.length === 0}
					<div
						class="flex flex-col items-center justify-center py-8 text-muted-foreground"
					>
						<MessageSquareIcon class="mb-3 h-10 w-10" />
						<p class="text-base">No messages yet. Be the first!</p>
					</div>
				{:else}
					{#each $viewState.messages as message}
						<div
							class="flex items-center gap-3 rounded-lg border px-4 py-3 sm:gap-4"
						>
							<EthereumAvatar
								address={message.account}
								class="h-8 w-8 shrink-0 rounded-full"
								showAddressOnTap
							/>
							<Address
								value={message.account}
								class="hidden shrink-0 text-sm sm:inline-flex"
							/>
							<p class="min-w-0 flex-1 truncate text-base">{message.message}</p>
							<span
								class="overflow-hidden text-sm whitespace-nowrap text-muted-foreground"
							>
								{#if message.pending}
									<Spinner class="h-4 w-4" />
								{:else}
									{formatRelativeTime(message.timestamp, clock.now())}
								{/if}
							</span>
						</div>
					{/each}
				{/if}

				<!-- Refresh indicator -->
				<!-- {#if $viewStatus.loading}
					<div class="py-2 text-center text-sm text-muted-foreground">
						Refreshing...
					</div>
				{/if} -->

				<!-- Refresh error -->
				{#if $viewStatus.error}
					<div
						class="flex flex-col items-center justify-center gap-1 py-3 text-destructive"
					>
						<div class="flex items-center gap-2">
							<AlertCircleIcon class="h-5 w-5 shrink-0" />
							<span class="text-sm">Refresh failed, will retry</span>
							<Button
								variant="outline"
								size="sm"
								onclick={() => refreshChainData()}
							>
								Retry Now
							</Button>
						</div>
						{#if staleMessage}
							<span class="text-xs text-muted-foreground">{staleMessage}</span>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
