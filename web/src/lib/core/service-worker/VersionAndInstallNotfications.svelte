<script lang="ts">
	import {fly} from 'svelte/transition';
	import type {ServiceWorkerStore} from '.';

	interface Props {
		serviceWorker: ServiceWorkerStore;
		/** optional icon shown instead of the default glyph */
		src?: string;
		alt?: string;
	}

	const {serviceWorker, src, alt = ''}: Props = $props();

	function skip() {
		serviceWorker.skip();
	}

	function accept() {
		serviceWorker.skipWaiting();
	}

	const updateAvailable = $derived(
		$serviceWorker &&
			!$serviceWorker.notSupported &&
			!$serviceWorker.registering &&
			$serviceWorker.updateAvailable &&
			$serviceWorker.registration,
	);
</script>

<!-- Global notification live region, render this permanently at the end of the document -->
<div aria-live="assertive" class="notification-container">
	<div class="notification-container-inner">
		{#if updateAvailable}
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
				class="notification-panel"
				transition:fly={{delay: 250, duration: 300, x: +100}}
			>
				<div class="notification-content">
					<div class="notification-header">
						<div class="notification-icon-container">
							{#if src}
								<img {src} {alt} />
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
						<div class="notification-text-container">
							<p class="notification-title">A new version is available.</p>
							<p class="notification-description">Reload to get the update.</p>
							<div class="notification-buttons">
								<button type="button" class="reload-button" onclick={accept}
									>Reload</button
								>
								<button type="button" class="dismiss-button" onclick={skip}
									>Dismiss</button
								>
							</div>
						</div>
						<div class="close-button-container">
							<button type="button" class="close-button" onclick={skip}>
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
		{/if}
	</div>
</div>

<style>
	.notification-container {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
		display: flex;
		align-items: flex-end;
		padding: 1.5rem;
	}

	.notification-container-inner {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.notification-panel {
		pointer-events: auto;
		width: 100%;
		max-width: 24rem;
		overflow: hidden;
		border-radius: 0.5rem;
		background-color: white;
		box-shadow:
			0 10px 15px -3px rgba(0, 0, 0, 0.1),
			0 4px 6px -2px rgba(0, 0, 0, 0.05);
		border: 1px solid rgba(0, 0, 0, 0.05);
	}

	.notification-content {
		padding: 1rem;
	}

	.notification-header {
		display: flex;
		align-items: flex-start;
	}

	.notification-icon-container {
		flex-shrink: 0;
	}

	.notification-icon {
		width: 1.5rem;
		height: 1.5rem;
		color: rgb(156 163 175);
	}

	.notification-text-container {
		margin-left: 0.75rem;
		flex: 1 1 0%;
		padding-top: 0.125rem;
	}

	.notification-title {
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(17 24 39);
	}

	.notification-description {
		margin-top: 0.25rem;
		font-size: 0.875rem;
		color: rgb(107 114 128);
	}

	.notification-buttons {
		margin-top: 0.75rem;
		display: flex;
		gap: 1.75rem;
	}

	.reload-button {
		border-radius: 0.375rem;
		background-color: white;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(79 70 229);
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.reload-button:hover {
		color: rgb(67 56 202);
	}

	.reload-button:focus {
		outline: none;
	}

	.reload-button:focus-visible {
		box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.5);
	}

	.dismiss-button {
		border-radius: 0.375rem;
		background-color: white;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(55 65 81);
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.dismiss-button:hover {
		color: rgb(75 85 99);
	}

	.dismiss-button:focus {
		outline: none;
	}

	.dismiss-button:focus-visible {
		box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.5);
	}

	.close-button-container {
		margin-left: 1rem;
		display: flex;
		flex-shrink: 0;
	}

	.close-button {
		display: inline-flex;
		border-radius: 0.375rem;
		background-color: white;
		color: rgb(156 163 175);
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.close-button:hover {
		color: rgb(107 114 128);
	}

	.close-button:focus {
		outline: none;
	}

	.close-button:focus-visible {
		box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.5);
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

		.notification-container-inner {
			align-items: flex-end;
		}
	}
</style>
