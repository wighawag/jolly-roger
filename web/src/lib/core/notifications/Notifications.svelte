<script lang="ts">
	import {fly} from 'svelte/transition';
	import type {NotificationsService} from './';

	interface Props {
		notifications: NotificationsService;
	}

	const {notifications}: Props = $props();
</script>

<!-- Global notification live region, render this permanently at the end of the document -->
<div
	aria-live="assertive"
	class="pointer-events-none fixed inset-0 flex items-end px-4 py-6 sm:items-start sm:p-6"
>
	<div class="flex w-full flex-col items-center space-y-4 sm:items-end">
		{#each $notifications as notification (notification.id)}
			<!--
		Notification panel, dynamically insert this into the live region when it needs to be displayed
  
		Entering: "transform ease-out duration-300 transition"
		  From: "translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
		  To: "translate-y-0 opacity-100 sm:translate-x-0"
		Leaving: "transition ease-in duration-100"
		  From: "opacity-100"
		  To: "opacity-0"
	  -->
			<div
				class="pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black/5"
				transition:fly={{delay: 250, duration: 300, x: +100}}
			>
				<div class="p-4">
					<div class="flex items-start">
						<div class="shrink-0">
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
						<div class="ml-3 w-0 flex-1 pt-0.5">
							<p class="text-sm font-medium text-gray-900">
								{notification.title}
							</p>
							{#if notification.body}
								<p class="mt-1 text-sm text-gray-500">
									{notification.body}
								</p>
							{/if}
							<div class="mt-3 flex space-x-7">
								{#if notification.action}
									<button
										type="button"
										class="rounded-md bg-white text-sm font-medium text-gray-700 hover:text-gray-500 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
										onclick={() => notifications.onAction(notification.id)}
										>{notification.action.label}</button
									>
								{/if}
								<button
									type="button"
									class="rounded-md bg-white text-sm font-medium text-gray-700 hover:text-gray-500 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
									onclick={() => notifications.remove(notification.id)}
									>dismiss</button
								>
							</div>
						</div>
						<div class="ml-4 flex shrink-0">
							<button
								type="button"
								class="inline-flex rounded-md bg-white text-gray-400 hover:text-gray-500 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
								onclick={() => notifications.remove(notification.id)}
							>
								<span class="sr-only">Close</span>
								<svg
									class="size-5"
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
