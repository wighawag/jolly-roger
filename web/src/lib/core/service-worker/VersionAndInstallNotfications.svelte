<script lang="ts">
	import type {ServiceWorkerStore} from '.';
	import NotificationCard from '../notifications/NotificationCard.svelte';
	import {
		isUpdateAvailable,
		UPDATE_NOTICE,
		updateActions,
		type NotificationClasses,
	} from '../notifications/view';

	interface Props {
		serviceWorker: ServiceWorkerStore;
		/** optional icon shown instead of the default glyph */
		src?: string;
		/** added to the card's root */
		class?: string;
		classes?: Partial<NotificationClasses>;
	}

	const {serviceWorker, src, class: className, classes = {}}: Props = $props();
</script>

<!--
	The update notice's live region, render this permanently at the end of the
	document. The behaviour only: the notice is a notification with two actions,
	painted by `../notifications/NotificationCard.svelte` (the file a kit
	rewrites), its state, wording and buttons decided by
	`../notifications/view.ts`.
-->
<div aria-live="assertive" class="notification-region">
	<div class="notification-stack">
		{#if isUpdateAvailable($serviceWorker)}
			<NotificationCard
				notification={{...UPDATE_NOTICE, icon: src}}
				actions={updateActions(serviceWorker)}
				class={className}
				{classes}
			/>
		{/if}
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
