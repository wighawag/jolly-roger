<script lang="ts">
	// "Notify me of new greetings": renders the notifications store
	// ($lib/push/notifications) and calls its two actions. Every decision is the
	// store's; this only says which state it is in.
	import {Button} from '$lib/shadcn/ui/button';
	import {Spinner} from '$lib/shadcn/ui/spinner';
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import type {Notifications} from '$lib/push/notifications';

	let {
		notifications,
		directMessages = false,
	}: {
		notifications: Notifications;
		/**
		 * with/messaging: the account is registered with missiv, which pushes a
		 * direct message to every device registered here
		 */
		directMessages?: boolean;
	} = $props();

	// the other accounts this device is notified for, in this app (QA F21)
	const others = $derived(
		$notifications.status === 'not-configured'
			? []
			: (($notifications.otherAccounts ?? []) as `0x${string}`[]),
	);
</script>

<div
	class="flex min-h-9 items-center justify-between gap-2 text-sm text-muted-foreground"
	data-testid="notify-me"
	data-status={$notifications.status}
	data-trigger={$notifications.status === 'not-configured'
		? undefined
		: $notifications.trigger}
	data-worker={$notifications.status === 'no-worker'
		? $notifications.worker
		: undefined}
	data-other-accounts={others.length > 0 ? others.join(' ') : undefined}
>
	{#if $notifications.status === 'not-configured'}
		<p data-testid="notifications-not-configured">
			Notifications are not configured for this app.
		</p>
	{:else if $notifications.status === 'unsupported'}
		<p>This browser cannot receive push notifications.</p>
	{:else if $notifications.status === 'no-account'}
		<!-- not a bare "Sign in": the connection flow's own button is named that -->
		<p class="flex items-center gap-2">
			<BellOffIcon class="h-4 w-4" /> Not notified of new greetings.
		</p>
		<Button
			variant="outline"
			size="sm"
			data-testid="notify-me-sign-in"
			onclick={() => notifications.signIn()}>Sign in to be notified</Button
		>
	{:else if $notifications.status === 'no-worker'}
		{#if $notifications.worker === 'off-in-dev'}
			<p>
				Notifications need the service worker, which is off in development: set
				PUBLIC_ENABLE_SW_IN_DEV=true, or use a build.
			</p>
		{:else if $notifications.worker === 'failed-in-dev'}
			<p>
				Notifications need the service worker, which did not start: in
				development it is a module worker, which only Chromium-based browsers
				run. Use a build in this browser.
			</p>
		{:else}
			<p>
				Notifications need the app's service worker, which did not start in this
				browser.
			</p>
		{/if}
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
	{:else if others.length > 0}
		<p
			class="flex flex-wrap items-center gap-1"
			data-testid="notify-me-other-account"
		>
			<BellOffIcon class="h-4 w-4" /> This device is notified for
			{others.length > 1 ? 'other accounts' : 'another account'} (
			{#each others as other, i (other)}
				{#if i > 0},{/if}
				<Address
					value={other}
					size="sm"
					mono
					showCopy={false}
					resolveENS={false}
				/>
			{/each}
			), not this one.
		</p>
		<span class="flex gap-2">
			{#if !notifications.oneAccountPerDevice}
				<Button
					variant="outline"
					size="sm"
					data-testid="notify-me-on"
					onclick={() => notifications.enable()}>Notify this one too</Button
				>
			{/if}
			<Button
				variant="outline"
				size="sm"
				data-testid="notify-me-switch"
				onclick={() => notifications.switchHere()}
				>Switch it to this account</Button
			>
		</span>
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
{#if directMessages && $notifications.status === 'on'}
	<p
		class="flex items-center gap-2 text-sm text-muted-foreground"
		data-testid="notify-me-direct-messages"
	>
		<BellIcon class="h-4 w-4" /> Direct messages to you are notified too.
	</p>
{/if}
{#if $notifications.status === 'unregistered' && !$notifications.busy && others.length > 0}
	<p
		class="text-sm text-muted-foreground"
		data-testid="notify-me-switch-warning"
	>
		Switching stops {others.length > 1 ? "those accounts'" : "that account's"}
		notifications on this device; {others.length > 1 ? 'they keep' : 'it keeps'}
		{others.length > 1 ? 'their' : 'its'} other devices.
	</p>
{/if}
{#if $notifications.status === 'on' && others.length > 0}
	<p
		class="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
		data-testid="notify-me-also-other-account"
	>
		This device is also notified for
		{#each others as other, i (other)}
			{#if i > 0},{/if}
			<Address
				value={other}
				size="sm"
				mono
				showCopy={false}
				resolveENS={false}
			/>
		{/each}.
		<button
			class="underline"
			data-testid="notify-me-only-this"
			onclick={() => notifications.switchHere()}
			>Notify only this account</button
		>
		(the {others.length > 1 ? 'others are' : 'other is'} then no longer notified here).
	</p>
{/if}
{#if $notifications.status !== 'not-configured' && $notifications.error}
	<p class="text-sm text-destructive" data-testid="notify-me-error">
		{String($notifications.error)}
		<button
			class="ml-2 underline"
			onclick={() => notifications.acknowledgeError()}>dismiss</button
		>
	</p>
{/if}
