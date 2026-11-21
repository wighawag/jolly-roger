<script lang="ts">
	import {fly} from 'svelte/transition';
	import type {
		NotificationAction,
		NotificationClasses,
		NotificationData,
		NotificationLayout,
	} from './view';

	interface Props {
		notification: NotificationData;
		actions: NotificationAction[];
		/** a panel in a stack, or one row across the page */
		layout?: NotificationLayout;
		class?: string;
		classes?: Partial<NotificationClasses>;
	}

	const {
		notification,
		actions,
		layout = 'card',
		class: className = '',
		classes = {},
	}: Props = $props();
</script>

<!--
	THE PAINT OF A NOTIFICATION, and the one notification file a kit rewrites.

	Which notifications show, which actions they offer and the live region they
	are announced in are the behaviour, in `./Notifications.svelte`,
	`../service-worker/VersionAndInstallNotfications.svelte` and `./view.ts`, the
	same at every level. This file only paints what it is handed, here in plain
	CSS; a level with a UI kit (Tailwind, shadcn) replaces it, keeping these
	props, so restyling the notifications is one modified file.
-->
<div
	class={[
		'notification-panel',
		layout === 'banner' && 'banner',
		className,
		classes.root,
	]}
	transition:fly={{delay: 250, duration: 300, x: +100}}
>
	<div class="notification-content">
		<div class={['icon-container', classes.icon]}>
			{#if notification.icon}
				<img src={notification.icon} alt="icon" />
			{:else}
				<svg
					class="notification-icon"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.5"
					stroke="currentColor"
					aria-hidden="true"
					data-slot="icon"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z"
					/>
				</svg>
			{/if}
		</div>
		<div class="notification-text">
			<div>
				<p class={['notification-title', classes.title]}>
					{notification.title}
				</p>
				{#if notification.body}
					<p class={['notification-body', classes.body]}>
						{notification.body}
					</p>
				{/if}
			</div>
			{#if actions.length > 0}
				<div class={['button-container', classes.actions]}>
					{#each actions as action}
						<button
							type="button"
							class={[
								'notification-button',
								action.primary && 'primary',
								action.primary ? classes.primaryButton : classes.button,
							]}
							onclick={() => action.onClick()}>{action.label}</button
						>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.notification-panel {
		pointer-events: auto;
		width: 100%;
		max-width: 24rem;
		overflow: hidden;
		border-radius: 0.5rem;
		background-color: white;
		border: 1px solid rgb(0 0 0 / 0.05);
		box-shadow:
			0 10px 15px -3px rgb(0 0 0 / 0.1),
			0 4px 6px -4px rgb(0 0 0 / 0.1);
	}

	.notification-content {
		display: flex;
		align-items: flex-start;
		padding: 1rem;
	}

	.icon-container {
		flex-shrink: 0;
	}

	.notification-icon {
		width: 1.5rem;
		height: 1.5rem;
		color: rgb(156 163 175);
	}

	.notification-text {
		margin-left: 0.75rem;
		width: 0;
		flex: 1;
		padding-top: 0.125rem;
	}

	.banner {
		max-width: 42rem;
	}

	.banner .notification-content {
		align-items: center;
		padding: 0.75rem 1rem;
	}

	.banner .notification-text {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		padding-top: 0;
	}

	.banner .button-container {
		margin-top: 0;
	}

	.notification-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(17 24 39);
	}

	.notification-body {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: rgb(107 114 128);
	}

	.button-container {
		margin-top: 0.75rem;
		display: flex;
		gap: 1.75rem;
	}

	.notification-button {
		border-radius: 0.375rem;
		background: transparent;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(55 65 81);
		border: none;
		cursor: pointer;
		padding: 0;
	}

	.notification-button:hover {
		color: rgb(107 114 128);
	}

	.notification-button.primary {
		color: rgb(79 70 229);
	}

	.notification-button.primary:hover {
		color: rgb(67 56 202);
	}

	.notification-button:focus {
		outline: none;
	}

	.notification-button:focus-visible {
		box-shadow: 0 0 0 2px rgb(99 102 241);
	}
</style>
