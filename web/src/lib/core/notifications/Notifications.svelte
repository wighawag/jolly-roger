<script lang="ts">
	import type {NotificationsService} from '.';
	import NotificationCard from './NotificationCard.svelte';
	import {notificationActions, type NotificationClasses} from './view';

	interface Props {
		notifications: NotificationsService;
		/** added to every card's root */
		class?: string;
		classes?: Partial<NotificationClasses>;
	}

	const {notifications, class: className, classes = {}}: Props = $props();
</script>

<!--
	Global notification live region, render this permanently at the end of the
	document. The behaviour only: each card is painted by `./NotificationCard.svelte`
	(the file a kit rewrites), its buttons decided by `./view.ts`.
-->
<div aria-live="assertive" class="notification-region">
	<div class="notification-stack">
		{#each $notifications as notification (notification.id)}
			<NotificationCard
				{notification}
				actions={notificationActions(notification, notifications)}
				class={className}
				{classes}
			/>
		{/each}
	</div>
</div>

<style>
	.notification-region {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: flex-end;
		padding: 1.5rem 1rem;
		pointer-events: none;
	}

	.notification-stack {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		gap: 1rem;
	}

	@media (min-width: 640px) {
		.notification-region {
			align-items: flex-start;
			padding: 1.5rem;
		}

		.notification-stack {
			align-items: flex-end;
		}
	}
</style>
