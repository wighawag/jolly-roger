<script lang="ts">
	import {fly} from 'svelte/transition';
	import type {NotificationsService} from './';

	interface Props {
		notifications: NotificationsService;
	}

	const {notifications}: Props = $props();
</script>

<!-- Global notification live region, render this permanently at the end of the document -->
<div aria-live="assertive" class="notification-container">
	<div class="notification-wrapper">
		{#each $notifications as notification (notification.id)}
			<div
				class="notification-panel"
				transition:fly={{delay: 250, duration: 300, x: +100}}
			>
				<div class="notification-content">
					<div class="notification-header">
						<div class="icon-container">
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
							<p class="notification-title">{notification.title}</p>
							{#if notification.body}
								<p class="notification-body">{notification.body}</p>
							{/if}
							<div class="button-container">
								{#if notification.action}
									<button
										type="button"
										class="notification-button"
										onclick={() => notifications.onAction(notification.id)}
										>{notification.action.label}</button
									>
								{/if}
								<button
									type="button"
									class="notification-button"
									onclick={() => notifications.remove(notification.id)}
									>dismiss</button
								>
							</div>
						</div>
						<div class="close-button-container">
							<button
								type="button"
								class="close-button"
								onclick={() => notifications.remove(notification.id)}
							>
								<span class="sr-only">Close</span>
								<svg
									class="close-icon"
									viewBox="0 0 20 20"
									fill="currentColor"
									aria-hidden="true"
									data-slot="icon"
								>
									<path
										d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
									/>
								</svg>
							</button>
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.notification-container {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: flex-end;
		padding: 1.5rem;
		pointer-events: none;
	}

	.notification-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		gap: 1rem;
	}

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
		padding: 1rem;
	}

	.notification-header {
		display: flex;
		align-items: flex-start;
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

	.notification-title {
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(17 24 39);
	}

	.notification-body {
		margin-top: 0.25rem;
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
		background-color: white;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(55 65 81);
		border: none;
		cursor: pointer;
		padding: 0.5rem 1rem;
	}

	.notification-button:hover {
		color: rgb(107 114 128);
	}

	.notification-button:focus {
		outline: none;
		box-shadow: 0 0 0 2px rgb(99 102 241);
	}

	.close-button-container {
		margin-left: 1rem;
		display: flex;
		flex-shrink: 0;
	}

	.close-button {
		border-radius: 0.375rem;
		background-color: white;
		color: rgb(156 163 175);
		border: none;
		cursor: pointer;
		padding: 0.25rem;
	}

	.close-button:hover {
		color: rgb(107 114 128);
	}

	.close-button:focus {
		outline: none;
		box-shadow: 0 0 0 2px rgb(99 102 241);
	}

	.close-icon {
		width: 1.25rem;
		height: 1.25rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (min-width: 640px) {
		.notification-container {
			align-items: flex-start;
			padding: 1.5rem;
		}

		.notification-wrapper {
			align-items: flex-end;
		}
	}
</style>
