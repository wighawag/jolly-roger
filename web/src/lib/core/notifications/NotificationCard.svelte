<script lang="ts">
	import * as Card from '$lib/shadcn/ui/card/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {fly} from 'svelte/transition';
	import {cn} from '$lib/core/utils/tailwind/index.js';
	import type {NotificationClasses} from './types';

	export type NotificationData = {
		title: string;
		body?: string;
		icon?: string;
	};

	export interface NotificationAction {
		label: string;
		onClick: () => void;
		primary?: boolean;
	}

	interface Props {
		actions: NotificationAction[];
		notification: NotificationData;
		class?: string;
		classes?: Partial<NotificationClasses>;
	}

	const {
		notification,
		actions,
		class: className = '',
		classes = {},
	}: Props = $props();
</script>

<!--
Notification panel, dynamically insert this into the live region when it needs to be displayed

Enters with fly transition from right
-->
<div
	class={cn(
		// Positioning and layout only - no colors/styling
		'pointer-events-auto w-full max-w-sm',
		className,
		classes.root,
	)}
	transition:fly={{delay: 250, duration: 300, x: +100}}
>
	<Card.Root class="py-3">
		<div class="flex items-start gap-3 px-4">
			<div class="flex flex-1 flex-col gap-1">
				<div class="flex items-start gap-3">
					{#if notification.icon}
						<img src={notification.icon} alt="icon" class="size-6 shrink-0" />
					{:else}
						<svg
							class="size-6 shrink-0"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="1.5"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z"
							/>
						</svg>
					{/if}
					<div class="flex flex-col gap-1">
						<Card.Title class={classes.title}>{notification.title}</Card.Title>
						{#if notification.body}
							<Card.Description class={classes.body}
								>{notification.body}</Card.Description
							>
						{/if}
					</div>
				</div>

				{#if actions.length > 0}
					<div class={cn('flex justify-end gap-2', classes.actions)}>
						{#each actions as action}
							<Button
								variant={action.primary ? 'default' : 'ghost'}
								size="sm"
								class={cn(
									action.primary ? classes.primaryButton : classes.button,
								)}
								onclick={() => action.onClick()}
							>
								{action.label}
							</Button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</Card.Root>
</div>
