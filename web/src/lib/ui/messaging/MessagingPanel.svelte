<script lang="ts">
	// The shell's messaging panel (`with/messaging`): a launcher, and a side panel
	// with the domain's chat room, the direct conversations and one conversation.
	// Renders `$lib/messaging`'s stores; every decision is theirs.
	import * as Drawer from '$lib/shadcn/ui/drawer';
	import {Button} from '$lib/shadcn/ui/button';
	import {Badge} from '$lib/shadcn/ui/badge';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
	import RoomView from './RoomView.svelte';
	import InboxView from './InboxView.svelte';
	import ConversationView from './ConversationView.svelte';
	import Join from './Join.svelte';
	import type {Messaging} from '$lib/messaging/messaging';

	let {messaging}: {messaging: Messaging} = $props();

	// svelte-ignore state_referenced_locally
	const {panel, services} = messaging;
	const inbox = panel.inbox;
	const view = panel.conversationView;
</script>

<button
	class="fixed bottom-4 left-4 flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-md hover:bg-accent"
	data-testid="messaging-launcher"
	aria-label="Messages"
	onclick={() => panel.toggle()}
>
	<MessagesSquareIcon class="h-4 w-4" />
	<span class="hidden sm:inline">Messages</span>
	{#if inbox && $inbox?.step === 'Fetched' && $inbox.count > 0}
		<Badge data-testid="messaging-count">{$inbox.count}</Badge>
	{/if}
</button>

<Drawer.Root
	open={$panel.open}
	onOpenChange={(open) => {
		if (!open) panel.close();
	}}
	direction="left"
>
	<Drawer.Content class="gap-3 p-4 select-text **:select-text">
		<div
			class="flex h-full min-h-0 flex-col gap-3"
			data-testid="messaging-panel"
			data-status={$messaging.status}
		>
			<Drawer.Title>Messages</Drawer.Title>
			{#if $messaging.status === 'not-configured' || !services}
				{#if $messaging.status === 'loading'}
					<Spinner class="h-4 w-4" />
				{:else}
					<p
						class="text-sm text-muted-foreground"
						data-testid="messaging-not-configured"
					>
						Messaging is not configured for this app.
					</p>
				{/if}
			{:else}
				<div class="flex gap-2">
					<Button
						size="sm"
						variant={$panel.view.kind === 'room' ? 'default' : 'outline'}
						data-testid="messaging-tab-room"
						onclick={() => panel.show({kind: 'room'})}>Chat</Button
					>
					<Button
						size="sm"
						variant={$panel.view.kind === 'room' ? 'outline' : 'default'}
						data-testid="messaging-tab-direct"
						onclick={() => panel.show({kind: 'direct'})}
						>Direct{#if inbox && $inbox?.step === 'Fetched' && $inbox.count > 0}
							({$inbox.count}){/if}</Button
					>
				</div>
				{#if $panel.error}
					<p
						class="text-sm text-destructive"
						data-testid="messaging-panel-error"
					>
						{$panel.error}
						<button class="ml-2 underline" onclick={() => panel.dismissError()}
							>dismiss</button
						>
					</p>
				{/if}
				{#if $panel.view.kind === 'room'}
					<RoomView room={services.room} {messaging} />
				{:else if $messaging.status !== 'registered'}
					<Join {messaging} />
				{:else if $panel.view.kind === 'direct' && inbox}
					<InboxView {inbox} {panel} />
				{:else if $view}
					{#key `${$view.address}:${$view.accepted}`}
						<ConversationView view={$view} {panel} />
					{/key}
				{:else if $panel.view.kind === 'conversation'}
					<span
						class="flex items-center gap-2 text-sm text-muted-foreground"
						data-testid="messaging-conversation-loading"
						><Spinner class="h-4 w-4" /> Loading the conversation...</span
					>
				{/if}
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
