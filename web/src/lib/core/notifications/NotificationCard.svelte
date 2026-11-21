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
	THE PAINT OF A NOTIFICATION, here in Tailwind UI classes: the one
	notification file this kit rewrites. The behaviour (which notifications, their
	actions, the live region) is the root's, in `./Notifications.svelte`,
	`../service-worker/VersionAndInstallNotfications.svelte` and `./view.ts`.

	Entering: "transform ease-out duration-300 transition"
	  From: "translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
	  To: "translate-y-0 opacity-100 sm:translate-x-0"
	Leaving: "transition ease-in duration-100"
	  From: "opacity-100"
	  To: "opacity-0"
-->
<div
	class={[
		'pointer-events-auto w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black/5',
		layout === 'banner' ? 'max-w-2xl' : 'max-w-sm',
		className,
		classes.root,
	]}
	transition:fly={{delay: 250, duration: 300, x: +100}}
>
	<div
		class={[
			'flex',
			layout === 'banner' ? 'items-center px-4 py-3' : 'items-start p-4',
		]}
	>
		<div class={['shrink-0', classes.icon]}>
			{#if notification.icon}
				<img src={notification.icon} alt="icon" />
			{:else}
				<svg
					class="size-6 text-gray-400"
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
		<div
			class={[
				'ml-3 w-0 flex-1',
				layout === 'banner'
					? 'flex flex-wrap items-center justify-between gap-x-6 gap-y-3'
					: 'pt-0.5',
			]}
		>
			<div>
				<p class={['text-sm font-medium text-gray-900', classes.title]}>
					{notification.title}
				</p>
				{#if notification.body}
					<p class={['mt-1 text-sm text-gray-500', classes.body]}>
						{notification.body}
					</p>
				{/if}
			</div>
			{#if actions.length > 0}
				<div
					class={[
						'flex space-x-7',
						layout !== 'banner' && 'mt-3',
						classes.actions,
					]}
				>
					{#each actions as action}
						<button
							type="button"
							class={[
								'rounded-md bg-white text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none',
								action.primary
									? [
											'text-indigo-600 hover:text-indigo-500',
											classes.primaryButton,
										]
									: ['text-gray-700 hover:text-gray-500', classes.button],
							]}
							onclick={() => action.onClick()}>{action.label}</button
						>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
