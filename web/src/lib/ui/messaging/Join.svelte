<script lang="ts">
	// What stands between the account and messaging, when something does: not
	// signed in, or not registered yet (one wallet signature, on first use).
	import {Button} from '$lib/shadcn/ui/button';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import type {Messaging} from '$lib/messaging/messaging';

	let {messaging}: {messaging: Messaging} = $props();
</script>

<div
	class="space-y-2 text-sm text-muted-foreground"
	data-testid="messaging-join"
>
	{#if $messaging.status === 'no-account'}
		<!-- not a bare "Sign in": the connection flow's own button is named that -->
		<Button
			size="sm"
			data-testid="messaging-sign-in"
			onclick={() => messaging.signIn()}
		>
			Sign in to write
		</Button>
	{:else if $messaging.status === 'loading'}
		<span class="flex items-center gap-2"><Spinner class="h-4 w-4" /> ...</span>
	{:else if $messaging.status === 'unregistered'}
		{#if $messaging.otherKey}
			<p>
				This account joined from another device or browser: joining here
				replaces it, and messages encrypted to the other become unreadable.
			</p>
		{/if}
		<Button
			size="sm"
			data-testid="messaging-register"
			disabled={$messaging.registering}
			onclick={() => messaging.register()}
		>
			{#if $messaging.registering}<Spinner class="mr-1 h-4 w-4" />{/if}
			Join the chat
		</Button>
	{/if}
	{#if ($messaging.status === 'unregistered' || $messaging.status === 'loading') && $messaging.error}
		<p class="text-destructive" data-testid="messaging-error">
			{$messaging.error.message}
		</p>
	{/if}
</div>
