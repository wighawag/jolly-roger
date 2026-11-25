<script lang="ts">
	// The domain's chat room: missiv's room store rendered, readable by anyone,
	// written once the account is registered (the room logs it in).
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import {Button} from '$lib/shadcn/ui/button';
	import MailIcon from '@lucide/svelte/icons/mail';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import Composer from './Composer.svelte';
	import Join from './Join.svelte';
	import {createComposer, roomAuthorToMessage} from '$lib/messaging/panel';
	import type {Messaging, Room} from '$lib/messaging/messaging';

	let {room, messaging}: {room: Room; messaging: Messaging} = $props();

	const composer = createComposer((text) => room.sendMessage(text));
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3" data-testid="messaging-room">
	{#if $room.step === 'Connecting'}
		<span class="flex items-center gap-2 text-sm text-muted-foreground"
			><Spinner class="h-4 w-4" /> Connecting to the chat...</span
		>
	{:else}
		<ul class="min-h-0 flex-1 space-y-2 overflow-y-auto">
			{#each $room.messages as message, i (i)}
				{@const author = roomAuthorToMessage(
					message.from,
					$messaging.status === 'registered' ? $messaging.address : undefined,
				)}
				<li
					class="text-sm"
					data-testid="room-message"
					data-from={message.from}
					data-pending={message.pending ? 'true' : undefined}
				>
					<Address value={message.from as `0x${string}`} size="xs" mono />
					{#if author}
						<!-- beside the address, not around it: Address holds its own copy
						     button (QA F2) -->
						<Button
							variant="ghost"
							size="icon"
							class="h-5 w-5 align-middle"
							title="Message this account"
							aria-label="Message this account"
							data-testid="room-message-author"
							onclick={() => messaging.panel.openConversation(author)}
						>
							<MailIcon class="h-3 w-3" />
						</Button>
					{/if}
					<span class={message.failed ? 'text-destructive' : ''}
						>{message.message}</span
					>
				</li>
			{:else}
				<li class="text-sm text-muted-foreground">No message yet.</li>
			{/each}
		</ul>
		{#if $room.loginStatus === 'LoggedIn'}
			<Composer
				{composer}
				placeholder="Say something..."
				testid="room-composer"
			/>
		{:else if $messaging.status === 'registered'}
			<span class="flex items-center gap-2 text-sm text-muted-foreground"
				><Spinner class="h-4 w-4" /> Joining the room...</span
			>
		{:else}
			<Join {messaging} />
		{/if}
	{/if}
</div>
