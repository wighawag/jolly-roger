<script lang="ts">
	import type {NotificationsService} from '.';
	import NotificationCard from './NotificationCard.svelte';
	import type {NotificationClasses} from './types';

	interface Props {
		notifications: NotificationsService;
		class?: string;
		classes?: Partial<NotificationClasses>;
	}

	const {notifications, class: className, classes = {}}: Props = $props();
</script>

{#each $notifications as n (n.id)}
	<NotificationCard
		notification={n}
		actions={n.action
			? [
					{
						label: n.action.label,
						onClick: () => notifications.onAction(n.id),
						primary: true,
					},
					{label: 'dismiss', onClick: () => notifications.remove(n.id)},
				]
			: [
					{
						label: 'dismiss',
						onClick: () => notifications.remove(n.id),
						primary: true,
					},
				]}
		class={className}
		{classes}
	/>
{/each}
