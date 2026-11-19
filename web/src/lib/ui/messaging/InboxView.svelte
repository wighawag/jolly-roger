<script lang="ts">
	// The account's direct conversations, as the panel's inbox lists them.
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import {Badge} from '$lib/shadcn/ui/badge';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import EthereumAvatar from '$lib/core/ui/ethereum/EthereumAvatar.svelte';
	import type {Inbox, MessagingPanel} from '$lib/messaging/panel';
	import type {Readable} from 'svelte/store';

	let {inbox, panel}: {inbox: Readable<Inbox>; panel: MessagingPanel} =
		$props();
</script>

<div class="min-h-0 flex-1 overflow-y-auto" data-testid="messaging-inbox">
	{#if $inbox.step !== 'Fetched'}
		<span class="flex items-center gap-2 text-sm text-muted-foreground"
			><Spinner class="h-4 w-4" /> Loading conversations...</span
		>
	{:else}
		<ul class="space-y-1">
			{#each $inbox.items as item (item.address)}
				<li>
					<button
						class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
						data-testid="inbox-item"
						data-address={item.address}
						data-accepted={item.accepted ? 'true' : 'false'}
						onclick={() => panel.openConversation(item.address)}
					>
						<EthereumAvatar
							address={item.address}
							class="h-6 w-6 shrink-0 rounded-full"
						/>
						<Address value={item.address} size="sm" />
						<span class="flex-1"></span>
						{#if !item.accepted}
							<Badge variant="outline">request</Badge>
						{:else if item.unread}
							<Badge>new</Badge>
						{/if}
					</button>
				</li>
			{:else}
				<li class="text-sm text-muted-foreground">
					No conversation yet. Open one from a greeting's author.
				</li>
			{/each}
		</ul>
	{/if}
</div>
