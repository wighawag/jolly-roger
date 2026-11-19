<script lang="ts">
	// "Notify me of new greetings": renders the notifications store
	// ($lib/push/notifications) and calls its two actions. Every decision is the
	// store's; this only says which state it is in.
	import {Button} from '$lib/shadcn/ui/button';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import type {Notifications} from '$lib/push/notifications';

	let {notifications}: {notifications: Notifications} = $props();
</script>

<div
	class="flex min-h-9 items-center justify-between gap-2 text-sm text-muted-foreground"
	data-testid="notify-me"
	data-status={$notifications.status}
	data-trigger={$notifications.status === 'not-configured'
		? undefined
		: $notifications.trigger}
>
	{#if $notifications.status === 'not-configured'}
		<p data-testid="notifications-not-configured">
			Notifications are not configured for this app.
		</p>
	{:else if $notifications.status === 'unsupported'}
		<p>This browser cannot receive push notifications.</p>
	{:else if $notifications.status === 'no-account'}
		<p>Sign in to be notified of new greetings.</p>
	{:else if $notifications.status === 'denied'}
		<p>Notifications are blocked for this site in the browser's settings.</p>
	{:else if $notifications.status === 'loading' || $notifications.busy}
		<span class="flex items-center gap-2"
			><Spinner class="h-4 w-4" /> Notifications...</span
		>
	{:else if $notifications.status === 'on'}
		<p class="flex items-center gap-2">
			<BellIcon class="h-4 w-4" /> You are notified of new greetings.
		</p>
		<Button
			variant="outline"
			size="sm"
			data-testid="notify-me-off"
			onclick={() => notifications.disable()}>Stop</Button
		>
	{:else}
		<p class="flex items-center gap-2">
			<BellOffIcon class="h-4 w-4" /> Not notified of new greetings.
		</p>
		<Button
			variant="outline"
			size="sm"
			data-testid="notify-me-on"
			onclick={() => notifications.enable()}>Notify me</Button
		>
	{/if}
</div>
{#if $notifications.status !== 'not-configured' && $notifications.error}
	<p class="text-sm text-destructive" data-testid="notify-me-error">
		{String($notifications.error)}
		<button
			class="ml-2 underline"
			onclick={() => notifications.acknowledgeError()}>dismiss</button
		>
	</p>
{/if}
