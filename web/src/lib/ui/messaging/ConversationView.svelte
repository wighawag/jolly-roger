<script lang="ts">
	// One direct conversation: missiv's conversation store rendered. A request
	// (someone wrote first) is shown with accept and block; a message is sent
	// encrypted to the other's verified key, or, only when asked, as an
	// introduction in clear to someone who has not joined yet.
	import {Button} from '$lib/shadcn/ui/button';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import Composer from './Composer.svelte';
	import {
		createComposer,
		type ConversationView,
		type MessagingPanel,
	} from '$lib/messaging/panel';

	let {view, panel}: {view: ConversationView; panel: MessagingPanel} = $props();

	// svelte-ignore state_referenced_locally
	const conversation = view.conversation;
	const encrypted = createComposer((text) => conversation.sendMessage(text));
	const introduction = createComposer((text) =>
		conversation.sendIntroduction(text),
	);
</script>

<div
	class="flex min-h-0 flex-1 flex-col gap-3"
	data-testid="messaging-conversation"
	data-with={view.address}
	data-accepted={view.accepted ? 'true' : 'false'}
>
	<div class="flex items-center gap-2">
		<Button
			variant="ghost"
			size="sm"
			aria-label="Back to the conversations"
			onclick={() => panel.show({kind: 'direct'})}
			><ArrowLeftIcon class="h-4 w-4" /></Button
		>
		<Address value={view.address} size="sm" />
	</div>

	{#if $conversation.step !== 'Fetched'}
		<span class="flex items-center gap-2 text-sm text-muted-foreground"
			><Spinner class="h-4 w-4" /> Loading messages...</span
		>
	{:else}
		<ul class="min-h-0 flex-1 space-y-2 overflow-y-auto">
			{#each $conversation.messages as message (message.messageID)}
				<li
					class="rounded-md px-2 py-1 text-sm {message.sender === view.address
						? 'bg-muted'
						: 'ml-8 bg-primary/10'}"
					data-testid="direct-message"
					data-sender={message.sender}
				>
					{#if message.error}
						<span class="text-destructive italic"
							>{message.error.code === 'undecryptable'
								? 'This message cannot be read here.'
								: 'This message is not proven to be from its sender.'}</span
						>
					{:else}
						{message.content}
					{/if}
				</li>
			{:else}
				<li class="text-sm text-muted-foreground">No message yet.</li>
			{/each}
		</ul>
	{/if}

	{#if !view.accepted}
		<div class="flex gap-2" data-testid="conversation-request">
			<Button
				size="sm"
				data-testid="conversation-accept"
				onclick={() => panel.accept(view.address)}>Accept</Button
			>
			<Button
				size="sm"
				variant="outline"
				data-testid="conversation-reject"
				onclick={() => panel.reject(view.address)}>Block</Button
			>
		</div>
	{:else if $conversation.otherUser.keySet}
		<Composer
			composer={encrypted}
			placeholder="Write a private message..."
			testid="direct-composer"
		/>
	{:else if $conversation.otherUser.unverifiedKey}
		<p class="text-sm text-destructive">
			Their key is not proven by their wallet: nothing can be sent to them.
		</p>
	{:else}
		<p class="text-sm text-muted-foreground">
			They have not joined the chat yet, so nothing can be encrypted to them. An
			introduction is sent in clear: the messaging server can read it.
		</p>
		<Composer
			composer={introduction}
			placeholder="Introduce yourself..."
			label="Send in clear"
			testid="introduction-composer"
		/>
	{/if}
</div>
